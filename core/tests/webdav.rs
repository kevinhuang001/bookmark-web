use axum::{body::Bytes,extract::{Request,State},http::{Method,StatusCode},response::{IntoResponse,Response},Router};
use glassmark_core::{store::Store,sync::{run,SyncConfig}};
use serde_json::json;
use std::{collections::HashMap,sync::{Arc,Mutex}};
#[derive(Default)]struct Remote{files:HashMap<String,Vec<u8>>,uploads:usize}
async fn dav(State(remote):State<Arc<Mutex<Remote>>>,req:Request)->Response{
    if req.headers().get("authorization").is_none(){return StatusCode::UNAUTHORIZED.into_response();}
    let method=req.method().clone();let path=req.uri().path().to_owned();
    if method.as_str()=="MKCOL"{return StatusCode::CREATED.into_response();}
    if method.as_str()=="PROPFIND"{let remote=remote.lock().unwrap();let mut xml="<d:multistatus xmlns:d=\"DAV:\">".to_owned();for key in remote.files.keys().filter(|k|k.starts_with(&path)){xml+=&format!("<d:response><d:href>{key}</d:href></d:response>");}xml+="</d:multistatus>";return ([("content-type","application/xml")],xml).into_response();}
    if method==Method::PUT{let bytes=axum::body::to_bytes(req.into_body(),128*1024*1024).await.unwrap();let mut remote=remote.lock().unwrap();if remote.files.contains_key(&path){return StatusCode::PRECONDITION_FAILED.into_response();}remote.files.insert(path,bytes.to_vec());remote.uploads+=1;return StatusCode::CREATED.into_response();}
    let remote=remote.lock().unwrap();let Some(bytes)=remote.files.get(&path)else{return StatusCode::NOT_FOUND.into_response()};
    if method==Method::HEAD{return StatusCode::OK.into_response();}(StatusCode::OK,Bytes::copy_from_slice(bytes)).into_response()
}
#[tokio::test]async fn two_devices_sync_files_folders_tags_and_tombstones(){
    let remote=Arc::new(Mutex::new(Remote::default()));remote.lock().unwrap().files.insert("/glassmark/events/old.json".into(),b"unsupported format".to_vec());let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();let app=Router::new().fallback(dav).with_state(remote.clone());let task=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
    let dir_a=tempfile::tempdir().unwrap();let dir_b=tempfile::tempdir().unwrap();let a=Store::open(dir_a.path().to_path_buf()).unwrap();let b=Store::open(dir_b.path().to_path_buf()).unwrap();let config=SyncConfig{enabled:true,url:format!("http://{addr}/"),username:"test".into(),password:"test".into()};
    let folder=a.event("folder",json!({"name":"Research"})).unwrap();
    let item=a.capture(json!({"version":2,"title":"Diffusion","text":"InSb research","url":"https://example.com","platform":"web","content":"<h1>Original UI</h1>","resources":[],"posts":[]})).unwrap();let id=item["id"].as_str().unwrap();
    assert_eq!(run(&a,config.clone()).await.unwrap(),2);assert_eq!(run(&b,config.clone()).await.unwrap(),2);
    assert_eq!(b.get(id).unwrap()["title"],"Diffusion");assert_eq!(std::fs::read_to_string(b.root.join("archives").join(id).join("content.html")).unwrap(),"<h1>Original UI</h1>");assert_eq!(b.list("folder","").unwrap().len(),1);
    let before=remote.lock().unwrap().uploads;run(&a,config.clone()).await.unwrap();assert_eq!(remote.lock().unwrap().uploads,before);
    let mut update=b.get(id).unwrap();update["tags"]=json!(["DFT"]);update["folderId"]=folder["id"].clone();b.event("item",update).unwrap();run(&b,config.clone()).await.unwrap();run(&a,config.clone()).await.unwrap();assert_eq!(a.get(id).unwrap()["tags"],json!(["DFT"]));
    let mut deleted=a.get(id).unwrap();deleted["deleted"]=json!(true);a.event("item",deleted).unwrap();run(&a,config.clone()).await.unwrap();run(&b,config.clone()).await.unwrap();assert!(b.list("item","").unwrap().is_empty());
    // Switching servers/directories must not inherit the previous endpoint's sent set.
    let mut other=config.clone();other.url=format!("http://{addr}/another/");run(&a,other).await.unwrap();assert!(remote.lock().unwrap().files.keys().any(|key|key.starts_with("/another/glassmark/content-v2/events/")));
    task.abort();
}
