//! Immutable, causally linked events retain concurrent branches for explicit resolution.
use crate::store::{atomic_write, valid_asset, valid_id, Result, Store};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{collections::HashSet,fs,io::Read,path::{Path,PathBuf}};
use sha2::{Digest,Sha256};

fn default_sync_interval()->u64{60}
fn default_sync_mode()->String{"webdav".into()}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SyncConfig { #[serde(default="default_sync_mode")]pub mode:String,#[serde(default)]pub local_path:String,pub url:String,pub username:String,#[serde(default)]pub password:String,#[serde(default="default_sync_interval")]pub interval_seconds:u64 }
impl Default for SyncConfig {fn default()->Self{Self{mode:default_sync_mode(),local_path:String::new(),url:String::new(),username:String::new(),password:String::new(),interval_seconds:default_sync_interval()}}}
impl SyncConfig {
    pub fn configured(&self)->bool {if self.mode=="local"{!self.local_path.trim().is_empty()}else{!self.url.trim().is_empty()}}
    pub fn poll_interval(&self)->u64 {if self.mode=="local"{5}else{self.interval_seconds.clamp(30,86400)}}
    pub fn validate(&self)->Result<()> {
        if self.mode=="webdav" && !(30..=86400).contains(&self.interval_seconds){return Err("同步周期应在 30 到 86400 秒之间".into());}
        if !["local","webdav"].contains(&self.mode.as_str()){return Err("同步方式只能选择本地或 WebDAV".into());}
        if !self.configured(){return Ok(());}
        if self.mode=="local" {
            if !Path::new(self.local_path.trim()).is_absolute(){return Err("本地同步路径不能为空且必须是绝对路径".into());}
            return Ok(());
        }
        let url=url::Url::parse(&self.url).map_err(|e|e.to_string())?;
        if !["http","https"].contains(&url.scheme())||url.host_str().is_none(){return Err("WebDAV 地址必须是 HTTP 或 HTTPS".into());}
        if !url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){return Err("请使用不含账号、查询参数或锚点的 WebDAV 地址".into());}Ok(())
    }
    pub fn read(store:&Store)->Self{fs::read(store.root.join("webdav.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default()}
    pub fn save(&self,store:&Store)->Result<()> {self.validate()?;atomic_write(&store.root.join("webdav.json"),&serde_json::to_vec(self).unwrap())}
}
fn event_name(name:&str)->bool{name.ends_with(".json")&&name.len()<100&&name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'.')&&!name.contains("..")}
struct Dav { client:Client,base:url::Url,config:SyncConfig }
impl Dav {
    fn url(&self,path:&str)->Result<url::Url>{self.base.join(path).map_err(|e|e.to_string())}
    fn req(&self,method:Method,path:&str)->Result<reqwest::RequestBuilder>{Ok(self.client.request(method,self.url(path)?).basic_auth(&self.config.username,Some(&self.config.password)))}
    async fn mkdir(&self,path:&str)->Result<()> {
        let response=self.req(Method::from_bytes(b"MKCOL").unwrap(),path)?.send().await.map_err(|e|e.to_string())?;
        if response.status().is_success()||response.status()==StatusCode::METHOD_NOT_ALLOWED{Ok(())}else{Err(format!("WebDAV MKCOL {path}: {}",response.status()))}
    }
    async fn put(&self,remote:&str,local:&Path)->Result<()> {
        let head=self.req(Method::HEAD,remote)?.send().await.map_err(|e|e.to_string())?;
        if head.status().is_success(){return self.verify_event(remote,local).await;}
        if head.status()!=StatusCode::NOT_FOUND{return Err(format!("WebDAV HEAD: {}",head.status()));}
        let file=tokio::fs::File::open(local).await.map_err(|e|e.to_string())?;
        let stream=tokio_util::io::ReaderStream::new(file);
        let response=self.req(Method::PUT,remote)?.header("If-None-Match","*").body(reqwest::Body::wrap_stream(stream)).send().await.map_err(|e|e.to_string())?;
        if response.status().is_success(){Ok(())}else if response.status()==StatusCode::PRECONDITION_FAILED{self.verify_event(remote,local).await}else{Err(format!("WebDAV PUT: {}",response.status()))}
    }
    async fn verify_event(&self,remote:&str,local:&Path)->Result<()> {
        if !remote.starts_with("events/"){return Ok(());}
        let response=self.req(Method::GET,remote)?.send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
        if response.content_length().is_some_and(|n|n>16*1024*1024){return Err("WebDAV 索引过大".into());}
        let bytes=response.bytes().await.map_err(|e|e.to_string())?;
        if bytes.len()>16*1024*1024 || bytes.as_ref()!=fs::read(local).map_err(|e|e.to_string())? {return Err("远端同步事件不一致，已停止同步".into());}
        Ok(())
    }
    async fn get_file(&self,remote:&str,local:&Path,limit:u64,hash:Option<&str>)->Result<()> {
        if local.is_file(){return Ok(());}
        let mut response=self.req(Method::GET,remote)?.send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
        if response.content_length().is_some_and(|n|n>limit){return Err("远端文件超过大小限制".into());}
        if let Some(parent)=local.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
        let temp=local.with_extension(format!("{}.part",uuid::Uuid::new_v4()));
        let result=async {
            use tokio::io::AsyncWriteExt;
            let mut out=tokio::fs::File::create(&temp).await.map_err(|e|e.to_string())?;let mut size=0;let mut hasher=Sha256::new();
            while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{size+=chunk.len() as u64;if size>limit{return Err("远端文件超过大小限制".into());}hasher.update(&chunk);out.write_all(&chunk).await.map_err(|e|e.to_string())?;}
            out.flush().await.map_err(|e|e.to_string())?;drop(out);
            if hash.is_some_and(|expected|format!("{:x}",hasher.finalize())!=expected){return Err("远端资源校验失败".into());}
            fs::rename(&temp,local).map_err(|e|e.to_string())
        }.await;
        if result.is_err(){let _=fs::remove_file(temp);}result
    }
}
fn archive_files(data:&Value)->Vec<&'static str>{if data["platform"]=="web"{vec!["content.html","manifest.json"]}else{vec!["manifest.json"]}}

fn file_sha256(path:&Path)->Result<String>{
    let mut file=fs::File::open(path).map_err(|e|e.to_string())?;
    let mut hasher=Sha256::new();
    let mut buffer=[0u8;65536];
    loop{let size=file.read(&mut buffer).map_err(|e|e.to_string())?;if size==0{break;}hasher.update(&buffer[..size]);}
    Ok(format!("{:x}",hasher.finalize()))
}
fn copy_once(source:&Path,destination:&Path,expected_hash:Option<&str>)->Result<()>{
    if !source.is_file(){return Err(format!("同步文件不存在：{}",source.display()));}
    if let Some(expected)=expected_hash{if file_sha256(source)?!=expected{return Err("同步资源校验失败".into());}}
    if destination.is_file(){
        if let Some(expected)=expected_hash{if file_sha256(destination)?!=expected{return Err("同步资源校验失败".into());}}
        return Ok(());
    }
    if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let temp=destination.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
    fs::copy(source,&temp).map_err(|e|e.to_string())?;
    if let Some(expected)=expected_hash{
        if file_sha256(&temp)?!=expected{let _=fs::remove_file(&temp);return Err("同步资源校验失败".into());}
    }
    if destination.exists(){
        let _=fs::remove_file(&temp);
        if let Some(expected)=expected_hash{if file_sha256(destination)?!=expected{return Err("同步资源校验失败".into());}}
        return Ok(());
    }
    match fs::hard_link(&temp,destination){
        Ok(())=>{fs::remove_file(&temp).map_err(|e|e.to_string())?;}
        Err(_) if destination.exists()=>{
            let _=fs::remove_file(&temp);
            if let Some(expected)=expected_hash{if file_sha256(destination)?!=expected{return Err("同步资源校验失败".into());}}
        }
        Err(_)=>{
            if destination.exists(){let _=fs::remove_file(&temp);return Ok(());}
            if let Err(error)=fs::rename(&temp,destination){let _=fs::remove_file(&temp);return Err(error.to_string());}
        }
    }
    Ok(())
}
fn copy_event_once(source:&Path,destination:&Path)->Result<()>{
    let expected=fs::read(source).map_err(|e|e.to_string())?;
    if destination.is_file(){
        if fs::read(destination).map_err(|e|e.to_string())?!=expected{return Err(format!("同步事件内容不一致：{}",destination.file_name().unwrap_or_default().to_string_lossy()));}
        return Ok(());
    }
    copy_once(source,destination,None)?;
    if fs::read(destination).map_err(|e|e.to_string())?!=expected{return Err("同步事件校验失败".into());}
    Ok(())
}
fn copy_archive(source_root:&Path,destination_root:&Path,event:&Value)->Result<()>{
    if event["kind"]!="item"||event["data"]["deleted"]==true{return Ok(());}
    let id=event["data"]["id"].as_str().ok_or("Missing archive id")?;
    if !valid_id(id){return Err("Invalid archive id".into());}
    let source=source_root.join("archives").join(id);
    let destination=destination_root.join("archives").join(id);
    fs::create_dir_all(destination.join("assets")).map_err(|e|e.to_string())?;
    for file in archive_files(&event["data"]){copy_once(&source.join(file),&destination.join(file),None)?;}
    if let Some(resources)=event["data"]["resources"].as_array(){
        for resource in resources{
            if resource["status"]!="saved"{continue;}
            let name=resource["name"].as_str().ok_or("Missing resource name")?;
            if !valid_asset(name){return Err("Invalid resource name".into());}
            let hash=name.split('.').next().unwrap();
            copy_once(&source.join("assets").join(name),&destination.join("assets").join(name),Some(hash))?;
        }
    }
    Ok(())
}
async fn run_local(store:&Store,config:&SyncConfig)->Result<usize>{
    let selected=PathBuf::from(config.local_path.trim());
    fs::create_dir_all(&selected).map_err(|e|e.to_string())?;
    let base=selected.join("glassmark");
    fs::create_dir_all(base.join("events")).map_err(|e|e.to_string())?;
    fs::create_dir_all(base.join("archives")).map_err(|e|e.to_string())?;
    let source_root=fs::canonicalize(&store.root).map_err(|e|e.to_string())?;
    let target_root=fs::canonicalize(&base).map_err(|e|e.to_string())?;
    if target_root.starts_with(&source_root)||source_root.starts_with(&target_root){
        return Err("本地同步目录不能位于 Glassmark 本地数据目录内或包含该目录".into());
    }
    let remote_events=target_root.join("events");
    let namespace=format!("local|{}|",target_root.display());
    let synced:HashSet<String>={
        let db=store.db.lock().map_err(|e|e.to_string())?;
        let mut stmt=db.prepare("SELECT event FROM synced").map_err(|e|e.to_string())?;
        let entries=stmt.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?
            .collect::<std::result::Result<_,_>>().map_err(|e|e.to_string())?;
        entries
    };
    let mut count=0;
    for entry in fs::read_dir(source_root.join("events")).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().to_string();
        if !event_name(&name){continue;}
        let remote=remote_events.join(&name);
        if synced.contains(&(namespace.clone()+&name))&&remote.is_file(){continue;}
        let bytes=fs::read(entry.path()).map_err(|e|e.to_string())?;
        if bytes.len()>16*1024*1024{return Err("本地同步事件超过大小限制".into());}
        let event:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
        crate::conflicts::validate_event(&event)?;
        if event["revision"].as_str().is_none_or(|revision|format!("{revision}.json")!=name){return Err("Invalid sync event filename".into());}
        copy_archive(&source_root,&target_root,&event)?;
        copy_event_once(&entry.path(),&remote)?;
        store.db.lock().map_err(|e|e.to_string())?.execute("INSERT OR IGNORE INTO synced VALUES(?1)",[&(namespace.clone()+&name)]).map_err(|e|e.to_string())?;
        count+=1;
    }
    for entry in fs::read_dir(&remote_events).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().to_string();
        if !event_name(&name){continue;}
        let remote=entry.path();
        let bytes=fs::read(&remote).map_err(|e|e.to_string())?;
        if bytes.len()>16*1024*1024{return Err("本地同步事件超过大小限制".into());}
        let local=source_root.join("events").join(&name);
        if local.is_file(){
            if fs::read(&local).map_err(|e|e.to_string())?!=bytes{return Err(format!("同步事件内容不一致：{name}"));}
            continue;
        }
        let event:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
        crate::conflicts::validate_event(&event)?;
        if event["revision"].as_str().is_none_or(|revision|format!("{revision}.json")!=name){return Err("Invalid sync event filename".into());}
        copy_archive(&target_root,&source_root,&event)?;
        atomic_write(&local,&bytes)?;
        if let Err(error)=store.index(&event){let _=fs::remove_file(&local);return Err(error);}
        store.db.lock().map_err(|e|e.to_string())?.execute("INSERT OR IGNORE INTO synced VALUES(?1)",[&(namespace.clone()+&name)]).map_err(|e|e.to_string())?;
        count+=1;
    }
    Ok(count)
}

pub async fn run(store:&Store,config:SyncConfig)->Result<usize>{
    config.validate()?;
    if !config.configured(){return Ok(0);}
    if config.mode=="local"{return run_local(store,&config).await;}
    run_webdav(store,config).await
}
async fn run_webdav(store:&Store,config:SyncConfig)->Result<usize>{
    let mut base=url::Url::parse(&(config.url.trim_end_matches('/').to_owned()+"/")).map_err(|e|e.to_string())?;
    // Dedicated subdirectory leaves the user's other WebDAV files untouched.
    base=base.join("glassmark/").map_err(|e|e.to_string())?;
    let dav=Dav{client:Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(300)).build().map_err(|e|e.to_string())?,base,config};
    dav.mkdir("").await?;dav.mkdir("events/").await?;dav.mkdir("archives/").await?;
    let namespace=format!("{}|{}|",dav.base,dav.config.username);
    let synced:HashSet<String>={let db=store.db.lock().map_err(|e|e.to_string())?;let mut stmt=db.prepare("SELECT event FROM synced").map_err(|e|e.to_string())?;let result=stmt.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<std::result::Result<_,_>>().map_err(|e|e.to_string())?;result};
    let mut count=0;
    for entry in fs::read_dir(store.root.join("events")).map_err(|e|e.to_string())? {
        let entry=entry.map_err(|e|e.to_string())?;let name=entry.file_name().to_string_lossy().to_string();if !event_name(&name)||synced.contains(&(namespace.clone()+&name)){continue;}
        let event:Value=serde_json::from_slice(&fs::read(entry.path()).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        crate::conflicts::validate_event(&event)?;
        if event["kind"]=="item"&&event["data"]["deleted"]!=true {
            let id=event["data"]["id"].as_str().ok_or("Missing id")?;if !valid_id(id){return Err("Invalid archive id".into());}
            let prefix=format!("archives/{id}/");dav.mkdir(&prefix).await?;dav.mkdir(&(prefix.clone()+"assets/")).await?;
            let local=store.root.join("archives").join(id);
            for file in archive_files(&event["data"]){dav.put(&(prefix.clone()+file),&local.join(file)).await?;}
            if let Some(resources)=event["data"]["resources"].as_array(){for resource in resources {if resource["status"]=="saved"{let name=resource["name"].as_str().ok_or("Missing resource name")?;if !valid_asset(name){return Err("Invalid resource name".into());}dav.put(&(prefix.clone()+"assets/"+name),&local.join("assets").join(name)).await?;}}}
        }
        dav.put(&("events/".to_owned()+&name),&entry.path()).await?;
        store.db.lock().map_err(|e|e.to_string())?.execute("INSERT OR IGNORE INTO synced VALUES(?1)",[&(namespace.clone()+&name)]).map_err(|e|e.to_string())?;count+=1;
    }
    let response=dav.req(Method::from_bytes(b"PROPFIND").unwrap(),"events/")?.header("Depth","1").header("Content-Type","application/xml").body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>").send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
    if response.content_length().is_some_and(|n|n>16*1024*1024){return Err("WebDAV 索引过大".into());}
    let xml=response.text().await.map_err(|e|e.to_string())?;if xml.len()>16*1024*1024{return Err("WebDAV 索引过大".into());}
    let doc=roxmltree::Document::parse(&xml).map_err(|e|e.to_string())?;
    let names:Vec<String>=doc.descendants().filter(|n|n.tag_name().name()=="href").filter_map(|n|n.text()).filter_map(|href|{
        let url=dav.base.join(href).ok()?;let root=dav.base.join("events/").ok()?;
        if url.origin()!=root.origin()||!url.path().starts_with(root.path()){return None;}
        let name=url.path().strip_prefix(root.path())?;if event_name(name){Some(name.to_owned())}else{None}
    }).collect();
    for name in names {
        let local=store.root.join("events").join(&name);if local.exists(){continue;}
        let temp=store.root.join("incoming").join(&name);dav.get_file(&("events/".to_owned()+&name),&temp,16*1024*1024,None).await?;
        let event:Value=serde_json::from_slice(&fs::read(&temp).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        crate::conflicts::validate_event(&event)?;
        if event["revision"].as_str().is_none_or(|revision|format!("{revision}.json")!=name){return Err("Invalid sync event filename".into());}
        let id=event["data"]["id"].as_str().ok_or("Missing id")?;if !valid_id(id){return Err("Invalid archive id".into());}
        if event["kind"]=="item"&&event["data"]["deleted"]!=true {
            let prefix=format!("archives/{id}/");let dir=store.root.join("archives").join(id);
            for file in archive_files(&event["data"]){dav.get_file(&(prefix.clone()+file),&dir.join(file),128*1024*1024,None).await?;}
            if let Some(resources)=event["data"]["resources"].as_array(){for resource in resources{if resource["status"]=="saved"{let name=resource["name"].as_str().ok_or("Missing resource name")?;if !valid_asset(name){return Err("Invalid resource name".into());}dav.get_file(&(prefix.clone()+"assets/"+name),&dir.join("assets").join(name),2*1024*1024*1024,Some(name.split('.').next().unwrap())).await?;}}}
        }
        // Persist first, index second. Store::open replays committed events after a crash.
        atomic_write(&local,&fs::read(&temp).map_err(|e|e.to_string())?)?;
        if let Err(error)=store.index(&event){let _=fs::remove_file(&local);return Err(error);}
        let _=fs::remove_file(temp);store.db.lock().map_err(|e|e.to_string())?.execute("INSERT OR IGNORE INTO synced VALUES(?1)",[&(namespace.clone()+&name)]).map_err(|e|e.to_string())?;count+=1;
    }
    Ok(count)
}

#[cfg(test)]mod tests{
use super::*;
#[test]fn rejects_unsafe_endpoints(){
assert!(SyncConfig{url:"http://example.com".into(),..Default::default()}.validate().is_ok());
assert!(SyncConfig{url:"ftp://example.com".into(),..Default::default()}.validate().is_err());
assert!(SyncConfig{interval_seconds:29,..Default::default()}.validate().is_err());
assert!(SyncConfig{url:"https://user:pass@example.com".into(),..Default::default()}.validate().is_err());
assert!(!event_name("../secret.json"));
}
#[test]fn selected_method_defaults_to_webdav(){
let config:SyncConfig=serde_json::from_str(r#"{"url":"https://example.com/dav/","username":"user","password":"secret","intervalSeconds":60}"#).unwrap();
assert_eq!(config.mode,"webdav");
assert_eq!(config.local_path,"");
assert!(config.validate().is_ok());
}
#[test]fn local_mode_requires_an_absolute_path(){
let mut config=SyncConfig{mode:"local".into(),..Default::default()};
assert!(config.validate().is_ok());
assert!(!config.configured());
config.local_path="/tmp/glassmark-sync".into();
assert!(config.validate().is_ok());
config.local_path="relative/path".into();
assert!(config.validate().is_err());
config.local_path.clear();
assert!(config.validate().is_ok());
}
#[test]fn selected_method_alone_controls_configuration_and_polling(){
let mut config=SyncConfig{mode:"local".into(),url:"https://example.com/dav".into(),interval_seconds:0,..Default::default()};
assert!(!config.configured());
assert!(config.validate().is_ok());
assert_eq!(config.poll_interval(),5);
config.local_path="/tmp/glassmark-share".into();
assert!(config.configured());
assert!(!serde_json::to_value(&config).unwrap().as_object().unwrap().contains_key("enabled"));
config.mode="webdav".into();
assert!(config.validate().is_err());
config.interval_seconds=90;
assert_eq!(config.poll_interval(),90);
assert!(config.validate().is_ok());
config.url.clear();
assert!(!config.configured());
}
#[tokio::test]async fn local_sync_creates_a_dedicated_glassmark_directory(){
let data=tempfile::tempdir().unwrap();
let share=tempfile::tempdir().unwrap();
let store=Store::open(data.path().join("data")).unwrap();
let folder=store.event("folder",serde_json::json!({"name":"Shared"})).unwrap();
let path=share.path().join("shared");
let config=SyncConfig{mode:"local".into(),local_path:path.display().to_string(),..Default::default()};
assert_eq!(run(&store,config.clone()).await.unwrap(),1);
assert!(path.join("glassmark/events").is_dir());
assert!(!path.join("glassmark/content-v2").exists());
assert!(path.join("glassmark/archives").is_dir());
assert!(path.join("glassmark/events").join(format!("{}.json",folder["revision"].as_str().unwrap())).is_file());
let second_data=tempfile::tempdir().unwrap();
let second=Store::open(second_data.path().join("data")).unwrap();
assert_eq!(run(&second,config).await.unwrap(),1);
assert_eq!(second.list("folder","").unwrap().len(),1);
}
}
