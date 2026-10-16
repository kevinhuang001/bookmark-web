//! Immutable revision events make concurrent device uploads non-destructive.
//! The greatest timestamp/UUID revision wins the materialized metadata index;
//! every conflicting revision remains available in WebDAV's events directory.
use crate::store::{atomic_write, valid_asset, valid_id, Result, Store};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{collections::HashSet,fs,path::Path};
use sha2::{Digest,Sha256};

#[derive(Clone,Debug,Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SyncConfig { pub enabled:bool,pub url:String,pub username:String,#[serde(default)]pub password:String }
impl SyncConfig {
    pub fn validate(&self)->Result<()> {
        if !self.enabled{return Ok(());}
        let url=url::Url::parse(&self.url).map_err(|e|e.to_string())?;
        if url.scheme()!="https" && !(url.scheme()=="http"&&[Some("127.0.0.1"),Some("localhost"),Some("[::1]")].contains(&url.host_str())){return Err("WebDAV 需要 HTTPS（本机测试地址除外）".into());}
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
        if head.status().is_success(){return Ok(());}
        if head.status()!=StatusCode::NOT_FOUND{return Err(format!("WebDAV HEAD: {}",head.status()));}
        let file=tokio::fs::File::open(local).await.map_err(|e|e.to_string())?;
        let stream=tokio_util::io::ReaderStream::new(file);
        let response=self.req(Method::PUT,remote)?.header("If-None-Match","*").body(reqwest::Body::wrap_stream(stream)).send().await.map_err(|e|e.to_string())?;
        if response.status().is_success()||response.status()==StatusCode::PRECONDITION_FAILED{Ok(())}else{Err(format!("WebDAV PUT: {}",response.status()))}
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
pub async fn run(store:&Store,config:SyncConfig)->Result<usize> {
    config.validate()?;if !config.enabled{return Ok(0);}
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
        let id=event["data"]["id"].as_str().ok_or("Missing id")?;if !valid_id(id){return Err("Invalid archive id".into());}
        if event["kind"]=="item"&&event["data"]["deleted"]!=true {
            let prefix=format!("archives/{id}/");let dir=store.root.join("archives").join(id);
            for file in archive_files(&event["data"]){dav.get_file(&(prefix.clone()+file),&dir.join(file),128*1024*1024,None).await?;}
            if let Some(resources)=event["data"]["resources"].as_array(){for resource in resources{if resource["status"]=="saved"{let name=resource["name"].as_str().ok_or("Missing resource name")?;if !valid_asset(name){return Err("Invalid resource name".into());}dav.get_file(&(prefix.clone()+"assets/"+name),&dir.join("assets").join(name),2*1024*1024*1024,Some(name.split('.').next().unwrap())).await?;}}}
        }
        // Persist first, index second. Store::open replays committed events after a crash.
        atomic_write(&local,&fs::read(&temp).map_err(|e|e.to_string())?)?;store.index(&event)?;
        let _=fs::remove_file(temp);store.db.lock().map_err(|e|e.to_string())?.execute("INSERT OR IGNORE INTO synced VALUES(?1)",[&(namespace.clone()+&name)]).map_err(|e|e.to_string())?;count+=1;
    }
    Ok(count)
}

#[cfg(test)]mod tests{use super::*;#[test]fn rejects_unsafe_endpoints(){assert!(SyncConfig{enabled:true,url:"http://example.com".into(),..Default::default()}.validate().is_err());assert!(SyncConfig{enabled:true,url:"https://user:pass@example.com".into(),..Default::default()}.validate().is_err());assert!(!event_name("../secret.json"));}}
