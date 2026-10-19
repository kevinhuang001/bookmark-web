pub mod conflicts;
pub mod preferences;
pub mod store;
pub mod sync;
use axum::{body::Bytes,extract::{Path,Query,Request,State,DefaultBodyLimit},http::{HeaderMap,HeaderValue,Method,StatusCode},middleware::{self,Next},response::{IntoResponse,Response},routing::{get,post,put},Json,Router};
use serde_json::{json,Value};
use std::{collections::HashMap,fs,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use store::{atomic_write,now,valid_asset,valid_id,Store};
use sha2::{Digest,Sha256};
use uuid::Uuid;
use tower_http::cors::{AllowOrigin,CorsLayer};
pub const PORT:u16=47831;
struct Pairing { code:String,expires:Instant,attempts:u8 }
#[derive(Clone)]pub struct AppState {pub store:Store,pub token:String,pairing:Arc<Mutex<Pairing>>,syncing:Arc<AtomicBool>,sync_status:Arc<Mutex<Value>>}
impl AppState {
    pub fn open(root:std::path::PathBuf)->store::Result<Self>{
        let store=Store::open(root.join("content-v2"))?;
        // Desktop token is process-scoped; paired device tokens persist independently.
        Ok(Self{store,token:format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple()),pairing:Arc::new(Mutex::new(new_pairing())),syncing:Arc::new(AtomicBool::new(false)),sync_status:Arc::new(Mutex::new(json!({"running":false})))})
    }
    pub fn connection(&self)->Value{json!({"base":format!("http://127.0.0.1:{PORT}"),"token":self.token})}
    pub async fn synchronize(&self)->store::Result<Value>{
        if self.syncing.swap(true,Ordering::SeqCst){return Ok(json!({"running":true}));}
        let result=sync::run(&self.store,sync::SyncConfig::read(&self.store)).await;
        self.syncing.store(false,Ordering::SeqCst);
        let status=match result{Ok(count)=>json!({"running":false,"lastSync":now(),"events":count,"conflicts":self.store.conflict_count().unwrap_or(0),"error":null}),Err(error)=>json!({"running":false,"error":error})};
        *self.sync_status.lock().unwrap()=status.clone();Ok(status)
    }
    fn schedule_sync(&self){let state=self.clone();tokio::spawn(async move {let _=state.synchronize().await;});}
}
fn new_pairing()->Pairing{let bytes=*Uuid::new_v4().as_bytes();let number=u32::from_be_bytes(bytes[..4].try_into().unwrap())%1_000_000;Pairing{code:format!("{number:06}"),expires:Instant::now()+Duration::from_secs(300),attempts:0}}
struct Error(StatusCode,String);
impl From<String> for Error{fn from(value:String)->Self{Self(StatusCode::BAD_REQUEST,value)}}
impl IntoResponse for Error{fn into_response(self)->Response{(self.0,Json(json!({"error":self.1}))).into_response()}}
type Result<T>=std::result::Result<T,Error>;
fn trusted_origin(origin:&str)->bool{
    if ["tauri://localhost","http://tauri.localhost","https://tauri.localhost","http://localhost:1420","http://127.0.0.1:1420"].contains(&origin){return true;}
    url::Url::parse(origin).is_ok_and(|url|["chrome-extension","moz-extension"].contains(&url.scheme())&&url.host_str().is_some()&&url.path().trim_matches('/').is_empty())
}
async fn boundary(req:Request,next:Next)->Response{
    let host=req.headers().get("host").and_then(|v|v.to_str().ok()).unwrap_or("");
    if ![format!("127.0.0.1:{PORT}"),format!("localhost:{PORT}")].contains(&host.to_owned()){return StatusCode::FORBIDDEN.into_response();}
    if req.headers().get("origin").is_some_and(|o|!o.to_str().is_ok_and(trusted_origin)){return StatusCode::FORBIDDEN.into_response();}
    next.run(req).await
}
async fn authorize(State(state):State<AppState>,req:Request,next:Next)->Response{
    let token=req.headers().get("authorization").and_then(|v|v.to_str().ok()).and_then(|s|s.strip_prefix("Bearer ")).unwrap_or("");
    let desktop=token==state.token;
    let paired=if !desktop {state.store.db.lock().unwrap().query_row("SELECT 1 FROM devices WHERE token=?1",[token],|r|r.get::<_,i32>(0)).is_ok()}else{false};
    if !desktop&&!paired{return StatusCode::UNAUTHORIZED.into_response();}
    let allowed=req.uri().path()=="/api/status" || (req.uri().path()=="/api/capture-options"&&req.method()==Method::GET) || (req.uri().path()=="/api/items"&&req.method()==Method::POST) || (req.uri().path().starts_with("/api/blobs/")&&req.method()==Method::PUT);
    if !desktop&&!allowed{return StatusCode::FORBIDDEN.into_response();}
    next.run(req).await
}
pub fn router(state:AppState)->Router{
    let api=Router::new().route("/api/status",get(status)).route("/api/pairing",post(pairing)).route("/api/devices",get(devices)).route("/api/devices/{token}",axum::routing::delete(revoke))
        .route("/api/items",get(items).post(capture)).route("/api/items/{id}",put(update_item).delete(delete_item)).route("/api/items/{id}/content/{file}",get(content)).route("/api/items/{id}/assets/{name}",get(asset))
        .route("/api/blobs/{name}",put(blob)).route("/api/folders",get(folders).post(create_folder)).route("/api/folders/{id}",put(update_folder))
        .route("/api/preferences",get(preferences).put(save_preferences)).route("/api/capture-options",get(capture_options)).route("/api/tags",get(tags).post(create_tag))
        .route("/api/conflicts",get(conflicts)).route("/api/conflicts/{id}/resolve",post(resolve_conflict))
        .route("/api/settings",get(settings).put(save_settings)).route("/api/sync",post(synchronize)).layer(middleware::from_fn_with_state(state.clone(),authorize));
    let cors=CorsLayer::new().allow_origin(AllowOrigin::predicate(|origin:&HeaderValue,_|origin.to_str().is_ok_and(trusted_origin))).allow_headers([axum::http::header::AUTHORIZATION,axum::http::header::CONTENT_TYPE,axum::http::header::IF_MATCH]).allow_methods([Method::GET,Method::POST,Method::PUT,Method::DELETE,Method::OPTIONS]);
    Router::new().route("/health",get(||async{Json(json!({"app":"glassmark","version":env!("CARGO_PKG_VERSION")}))})).route("/pair",post(pair)).merge(api)
        .layer(DefaultBodyLimit::max(2*1024*1024*1024)).layer(cors).layer(middleware::from_fn(boundary)).with_state(state)
}
async fn status(State(state):State<AppState>)->Json<Value>{Json(json!({"connected":true,"version":env!("CARGO_PKG_VERSION"),"conflicts":state.store.conflict_count().unwrap_or(0),"sync":state.sync_status.lock().unwrap().clone(),"running":state.syncing.load(Ordering::SeqCst)}))}
async fn pairing(State(state):State<AppState>)->Json<Value>{let mut pairing=state.pairing.lock().unwrap();*pairing=new_pairing();Json(json!({"code":pairing.code,"expiresIn":300}))}
async fn pair(State(state):State<AppState>,Json(input):Json<Value>)->Result<Json<Value>>{
    let mut p=state.pairing.lock().unwrap();p.attempts=p.attempts.saturating_add(1);
    if p.attempts>5||Instant::now()>p.expires||input["code"].as_str()!=Some(p.code.as_str()){return Err(Error(StatusCode::UNAUTHORIZED,"配对码失效或不正确，请在客户端重新生成".into()));}
    let token=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
    state.store.db.lock().unwrap().execute("INSERT INTO devices VALUES(?1,?2)",rusqlite::params![token,input["name"].as_str().unwrap_or("Browser")]).map_err(|e|e.to_string())?;
    *p=new_pairing();Ok(Json(json!({"token":token})))
}
async fn devices(State(state):State<AppState>)->Result<Json<Value>>{let db=state.store.db.lock().unwrap();let mut stmt=db.prepare("SELECT token,name FROM devices").map_err(|e|e.to_string())?;let rows=stmt.query_map([],|r|Ok(json!({"token":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?}))).map_err(|e|e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string())?;Ok(Json(json!(rows)))}
async fn revoke(State(state):State<AppState>,Path(token):Path<String>)->Result<Json<Value>>{state.store.db.lock().unwrap().execute("DELETE FROM devices WHERE token=?1",[token]).map_err(|e|e.to_string())?;Ok(Json(json!({"ok":true})))}
async fn items(State(state):State<AppState>,Query(query):Query<HashMap<String,String>>)->Result<Json<Value>>{Ok(Json(json!(state.store.list("item",query.get("q").map(String::as_str).unwrap_or(""))?)))}
async fn capture(State(state):State<AppState>,Json(value):Json<Value>)->Result<Json<Value>>{let item=state.store.capture(value)?;state.schedule_sync();Ok(Json(item))}
fn safe_id(id:&str)->Result<()>{if valid_id(id){Ok(())}else{Err("Invalid id".to_owned().into())}}
fn check_revision(headers:&HeaderMap,patch:&Value,current:&Value)->Result<()>{
    let expected=patch["baseRevision"].as_str().or_else(||headers.get(axum::http::header::IF_MATCH).and_then(|v|v.to_str().ok()));
    if expected.is_some_and(|revision|current["revision"]!=revision){return Err(Error(StatusCode::CONFLICT,"内容已更新，请刷新后重试".into()));}Ok(())
}
async fn update_item(State(state):State<AppState>,Path(id):Path<String>,headers:HeaderMap,Json(patch):Json<Value>)->Result<Json<Value>>{
    safe_id(&id)?;let _guard=state.store.writes.lock().map_err(|e|e.to_string())?;let mut value=state.store.get(&id)?;check_revision(&headers,&patch,&value)?;
    if !patch["tags"].is_null(){let tags=patch["tags"].as_array().ok_or("Tags must be an array".to_string())?;if tags.len()>100||tags.iter().any(|t|!t.is_string()||t.as_str().unwrap().len()>100){return Err("Invalid tags".to_string().into());}value["tags"]=patch["tags"].clone();}
    if let Some(title)=patch["title"].as_str(){if !title.trim().is_empty(){value["title"]=json!(title);}}
    if let Some(folder)=patch.get("folderId"){if !folder.is_null(){let found=state.store.get(folder.as_str().ok_or("Invalid folder".to_string())?)?;if found["name"].is_null()||found["deleted"]==true{return Err("Folder does not exist".to_string().into());}}value["folderId"]=folder.clone();}
    let saved=state.store.event_unlocked("item",value,None)?;state.schedule_sync();Ok(Json(saved))
}
async fn delete_item(State(state):State<AppState>,Path(id):Path<String>,headers:HeaderMap)->Result<Json<Value>>{safe_id(&id)?;let _guard=state.store.writes.lock().map_err(|e|e.to_string())?;let mut value=state.store.get(&id)?;check_revision(&headers,&Value::Null,&value)?;value["deleted"]=json!(true);state.store.event_unlocked("item",value,None)?;state.schedule_sync();Ok(Json(json!({"ok":true})))}
async fn tags(State(state):State<AppState>)->Result<Json<Value>>{Ok(Json(json!(state.store.list("tag","")?)))}
async fn create_tag(State(state):State<AppState>,Json(mut value):Json<Value>)->Result<Json<Value>>{
    let name=value["name"].as_str().unwrap_or("").trim().to_owned();
    if name.is_empty()||name.len()>100||!["web","x","reddit","xiaohongshu","zhihu"].contains(&value["platform"].as_str().unwrap_or("")){return Err("Invalid tag".to_string().into());}
    value["name"]=json!(name);value["id"]=json!(Uuid::new_v4());
    if let Some(existing)=state.store.list("tag","")?.into_iter().find(|t|t["name"]==value["name"]&&t["platform"]==value["platform"]){return Ok(Json(existing));}
    let saved=state.store.event("tag",value)?;state.schedule_sync();Ok(Json(saved))
}
async fn capture_options(State(state):State<AppState>)->Result<Json<Value>>{
    let mut tags=state.store.list("tag","")?;
    for item in state.store.list("item","")?{
        if let Some(names)=item["tags"].as_array(){for name in names{if !tags.iter().any(|t|t["name"]==*name&&t["platform"]==item["platform"]){tags.push(json!({"name":name,"platform":item["platform"]}));}}}
    }
    Ok(Json(json!({"folders":state.store.list("folder","")?,"tags":tags,"preferences":preferences::Preferences::read(&state.store)})))
}
async fn folders(State(state):State<AppState>)->Result<Json<Value>>{Ok(Json(json!(state.store.list("folder","")?)))}
fn validate_folder(state:&AppState,value:&Value)->store::Result<()>{
    if value["name"].as_str().is_none_or(|s|s.trim().is_empty()||s.len()>100){return Err("文件夹名称需要 1–100 个字节".into());}
    let mut parent=value["parentId"].as_str().map(str::to_owned);let mut visited=std::collections::HashSet::new();
    while let Some(id)=parent {if Some(id.as_str())==value["id"].as_str()||!visited.insert(id.clone()){return Err("文件夹不能包含自身或形成循环".into());}let folder=state.store.get(&id)?;if folder["name"].is_null(){return Err("父文件夹不存在".into());}parent=folder["parentId"].as_str().map(str::to_owned);}
    Ok(())
}
async fn create_folder(State(state):State<AppState>,Json(mut value):Json<Value>)->Result<Json<Value>>{value["id"]=json!(Uuid::new_v4());validate_folder(&state,&value)?;let saved=state.store.event("folder",value)?;state.schedule_sync();Ok(Json(saved))}
async fn update_folder(State(state):State<AppState>,Path(id):Path<String>,headers:HeaderMap,Json(patch):Json<Value>)->Result<Json<Value>>{safe_id(&id)?;let _guard=state.store.writes.lock().map_err(|e|e.to_string())?;let mut value=state.store.get(&id)?;check_revision(&headers,&patch,&value)?;for key in ["name","parentId"]{if let Some(v)=patch.get(key){value[key]=v.clone();}}validate_folder(&state,&value)?;let saved=state.store.event_unlocked("folder",value,None)?;state.schedule_sync();Ok(Json(saved))}
async fn blob(State(state):State<AppState>,Path(name):Path<String>,bytes:Bytes)->Result<Json<Value>>{
    if !valid_asset(&name)||format!("{:x}",Sha256::digest(&bytes))!=name.split('.').next().unwrap(){return Err("Invalid resource digest".to_string().into());}
    let path=state.store.root.join("blobs").join(name);if !path.exists(){atomic_write(&path,&bytes)?;}Ok(Json(json!({"ok":true})))
}
async fn content(State(state):State<AppState>,Path((id,file)):Path<(String,String)>)->Result<Response>{safe_id(&id)?;if !["content.html","manifest.json"].contains(&file.as_str()){return Err("Invalid file".to_string().into());}
    if file=="manifest.json"{return Ok(Json(state.store.get(&id)?).into_response());}
    let bytes=fs::read(state.store.root.join("archives").join(id).join(&file)).map_err(|e|e.to_string())?;
    Ok(([("content-type","text/plain; charset=utf-8"),("x-content-type-options","nosniff")],bytes).into_response())
}
async fn asset(State(state):State<AppState>,Path((id,name)):Path<(String,String)>)->Result<Response>{safe_id(&id)?;if !valid_asset(&name){return Err("Invalid resource name".to_string().into());}let bytes=fs::read(state.store.root.join("archives").join(id).join("assets").join(name)).map_err(|e|e.to_string())?;Ok(([("content-type","application/octet-stream"),("x-content-type-options","nosniff")],bytes).into_response())}
async fn preferences(State(state):State<AppState>)->Json<preferences::Preferences>{Json(preferences::Preferences::read(&state.store))}
async fn save_preferences(State(state):State<AppState>,Json(value):Json<preferences::Preferences>)->Result<Json<Value>>{value.save(&state.store)?;Ok(Json(json!({"ok":true})))}
async fn conflicts(State(state):State<AppState>)->Result<Json<Value>>{Ok(Json(json!(state.store.conflicts()?)))}
async fn resolve_conflict(State(state):State<AppState>,Path(id):Path<String>,Json(value):Json<Value>)->Result<Json<Value>>{
    safe_id(&id)?;
    let heads:Vec<String>=serde_json::from_value(value["heads"].clone()).map_err(|e|e.to_string())?;
    let choice=value["revision"].as_str().ok_or("Missing revision".to_string())?;
    let saved=state.store.resolve_conflict(&id,&heads,choice,value["mergeTags"]==true)?;
    state.schedule_sync();Ok(Json(saved))
}
async fn settings(State(state):State<AppState>)->Json<Value>{let mut value=serde_json::to_value(sync::SyncConfig::read(&state.store)).unwrap();value["hasPassword"]=json!(!value["password"].as_str().unwrap_or("").is_empty());value.as_object_mut().unwrap().remove("password");Json(value)}
async fn save_settings(State(state):State<AppState>,Json(mut value):Json<Value>)->Result<Json<Value>>{if value["password"].as_str().is_none_or(|s|s.is_empty()){value["password"]=json!(sync::SyncConfig::read(&state.store).password);}let config:sync::SyncConfig=serde_json::from_value(value).map_err(|e|e.to_string())?;config.save(&state.store)?;state.schedule_sync();Ok(Json(json!({"ok":true})))}
async fn synchronize(State(state):State<AppState>)->Result<Json<Value>>{Ok(Json(state.synchronize().await?))}
pub async fn serve(state:AppState)->store::Result<()>{
    let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,PORT)).await.map_err(|e|format!("无法监听本地端口 {PORT}：{e}"))?;
    let periodic=state.clone();tokio::spawn(async move{let mut last=Instant::now();let mut timer=tokio::time::interval(Duration::from_secs(1));loop{timer.tick().await;let config=sync::SyncConfig::read(&periodic.store);if config.enabled&&last.elapsed()>=Duration::from_secs(config.interval_seconds.clamp(30,86400)){last=Instant::now();let _=periodic.synchronize().await;}}});
    axum::serve(listener,router(state)).await.map_err(|e|e.to_string())
}

#[cfg(test)]mod tests{
    use super::*;
    use axum::body::{Body,to_bytes};
    use tower::ServiceExt;
    fn setup()->(tempfile::TempDir,AppState){let dir=tempfile::tempdir().unwrap();let state=AppState::open(dir.path().to_path_buf()).unwrap();(dir,state)}
    fn request(path:&str,token:Option<&str>)->Request{let mut builder=Request::builder().uri(path).header("host",format!("127.0.0.1:{PORT}"));if let Some(token)=token{builder=builder.header("authorization",format!("Bearer {token}"));}builder.body(Body::empty()).unwrap()}
    #[tokio::test]async fn rejects_unpaired_and_hostile_origins(){let (_dir,state)=setup();let router=router(state.clone());assert_eq!(router.clone().oneshot(request("/api/items",None)).await.unwrap().status(),StatusCode::UNAUTHORIZED);
        let mut req=request("/health",None);req.headers_mut().insert("origin",HeaderValue::from_static("https://attacker.test"));assert_eq!(router.clone().oneshot(req).await.unwrap().status(),StatusCode::FORBIDDEN);
        let response=router.oneshot(request("/api/items",Some(&state.token))).await.unwrap();assert_eq!(response.status(),StatusCode::OK);let bytes=to_bytes(response.into_body(),10000).await.unwrap();assert_eq!(&bytes[..],b"[]");
    }
    #[tokio::test]async fn extension_cannot_read_library_or_settings(){let (_dir,state)=setup();state.store.db.lock().unwrap().execute("INSERT INTO devices VALUES('paired','Chromium')",[]).unwrap();let router=router(state);
        assert_eq!(router.clone().oneshot(request("/api/status",Some("paired"))).await.unwrap().status(),StatusCode::OK);
        assert_eq!(router.clone().oneshot(request("/api/capture-options",Some("paired"))).await.unwrap().status(),StatusCode::OK);
        for path in ["/api/items","/api/settings","/api/pairing","/api/conflicts"]{assert_eq!(router.clone().oneshot(request(path,Some("paired"))).await.unwrap().status(),StatusCode::FORBIDDEN);}
    }
    #[test]fn folders_reject_self_and_ancestor_cycles(){let (_dir,state)=setup();let a=state.store.event("folder",json!({"name":"a"})).unwrap();let b=state.store.event("folder",json!({"name":"b","parentId":a["id"]})).unwrap();let mut changed=a;changed["parentId"]=b["id"].clone();assert!(validate_folder(&state,&changed).is_err());}
    #[test]fn new_content_store_does_not_load_other_formats(){let dir=tempfile::tempdir().unwrap();std::fs::create_dir_all(dir.path().join("events")).unwrap();std::fs::write(dir.path().join("events/old.json"),b"unsupported older content").unwrap();let state=AppState::open(dir.path().to_path_buf()).unwrap();assert_eq!(state.store.root,dir.path().join("content-v2"));assert!(state.store.list("item","").unwrap().is_empty());}
    #[test]fn origin_parser_rejects_lookalikes(){assert!(trusted_origin("chrome-extension://abcdefghijklmnop"));assert!(!trusted_origin("https://localhost.attacker.test:1420"));assert!(!trusted_origin("null"));}
}

#[cfg(test)]mod conflict_api_tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;
    #[tokio::test]async fn stale_edits_are_rejected_without_losing_the_newer_version(){
        let dir=tempfile::tempdir().unwrap();let state=AppState::open(dir.path().to_path_buf()).unwrap();
        let item=state.store.capture(json!({"version":2,"platform":"web","title":"A","text":"body","url":"https://example.com","content":"<p>A</p>","resources":[],"posts":[]})).unwrap();
        let mut newer=item.clone();newer["title"]=json!("Newer");state.store.event("item",newer).unwrap();
        let request=Request::builder().method("PUT").uri(format!("/api/items/{}",item["id"].as_str().unwrap())).header("host",format!("127.0.0.1:{PORT}")).header("authorization",format!("Bearer {}",state.token)).header("content-type","application/json").header("if-match",item["revision"].as_str().unwrap()).body(Body::from(r#"{"title":"Stale"}"#)).unwrap();
        assert_eq!(router(state.clone()).oneshot(request).await.unwrap().status(),StatusCode::CONFLICT);
        assert_eq!(state.store.get(item["id"].as_str().unwrap()).unwrap()["title"],"Newer");
    }
}
