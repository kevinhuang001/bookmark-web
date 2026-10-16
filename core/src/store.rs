use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone)]
pub struct Store { pub root: PathBuf, pub db: Arc<Mutex<Connection>> }
pub fn now() -> String { chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }
pub fn valid_id(id: &str) -> bool { Uuid::parse_str(id).is_ok() }
pub fn valid_asset(name: &str) -> bool {
    let mut parts=name.split('.'); let hash=parts.next().unwrap_or("");let ext=parts.next().unwrap_or("");
    hash.len()==64 && hash.bytes().all(|b|b.is_ascii_hexdigit()) && !ext.is_empty() && ext.len()<=8 && ext.bytes().all(|b|b.is_ascii_alphanumeric()) && parts.next().is_none()
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent)=path.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let temp=path.with_extension(format!("{}.tmp",Uuid::new_v4()));
    fs::write(&temp,bytes).map_err(|e|e.to_string())?;
    // Windows rename cannot replace an existing destination. Keep immutable event files,
    // while a small mutable config file uses remove+rename under the API's serialized call.
    if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?;}
    fs::rename(temp,path).map_err(|e|e.to_string())
}
impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("blobs")).map_err(|e|e.to_string())?;
        fs::create_dir_all(root.join("events")).map_err(|e|e.to_string())?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&root,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?; }
        let db=Connection::open(root.join("library.sqlite3")).map_err(|e|e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, revision TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,body,url,tags,tokenize='trigram');
        CREATE TABLE IF NOT EXISTS devices(token TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS synced(event TEXT PRIMARY KEY);").map_err(|e|e.to_string())?;
        let store=Self{root,db:Arc::new(Mutex::new(db))};
        // Events are the durable source of truth; replay also recovers after an interrupted index update.
        for entry in fs::read_dir(store.root.join("events")).map_err(|e|e.to_string())? {
            let path=entry.map_err(|e|e.to_string())?.path();
            if path.extension().is_some_and(|e|e=="json") {
                let value=serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
                store.index(&value)?;
            }
        }
        Ok(store)
    }
    pub fn event(&self, kind: &str, mut data: Value) -> Result<Value> {
        if data["id"].as_str().is_none(){data["id"]=json!(Uuid::new_v4().to_string());}
        data["modifiedAt"]=json!(now());
        let revision=format!("{}--{}",chrono::Utc::now().format("%Y%m%dT%H%M%S%9f"),Uuid::new_v4());
        let event=json!({"version":1,"revision":revision,"kind":kind,"data":data});
        atomic_write(&self.root.join("events").join(format!("{revision}.json")),&serde_json::to_vec_pretty(&event).unwrap())?;
        self.index(&event)?;Ok(event["data"].clone())
    }
    pub fn index(&self, event: &Value) -> Result<()> {
        let id=event["data"]["id"].as_str().ok_or("Missing id")?;
        if !valid_id(id){return Err("Invalid document id".into());}
        let revision=event["revision"].as_str().ok_or("Missing revision")?;
        let kind=event["kind"].as_str().ok_or("Missing kind")?;
        if !["item","folder","tag"].contains(&kind){return Err("Unknown event kind".into());}
        let mut db=self.db.lock().map_err(|e|e.to_string())?;
        let tx=db.transaction().map_err(|e|e.to_string())?;
        let current:Option<String>=tx.query_row("SELECT revision FROM documents WHERE id=?1",[id],|r|r.get(0)).ok();
        if current.is_some_and(|c|c.as_str()>=revision){return Ok(());}
        let data=&event["data"];
        tx.execute("INSERT OR REPLACE INTO documents VALUES(?1,?2,?3,?4)",params![id,revision,kind,data.to_string()]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM search WHERE id=?1",[id]).map_err(|e|e.to_string())?;
        if kind=="item" && data["deleted"]!=true {
            tx.execute("INSERT INTO search VALUES(?1,?2,?3,?4,?5)",params![id,data["title"].as_str().unwrap_or(""),data["text"].as_str().unwrap_or(""),data["url"].as_str().unwrap_or(""),data["tags"].to_string()]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())?;Ok(())
    }
    pub fn get(&self,id:&str)->Result<Value>{
        let db=self.db.lock().map_err(|e|e.to_string())?;
        let raw:String=db.query_row("SELECT data FROM documents WHERE id=?1",[id],|r|r.get(0)).map_err(|_|"Not found")?;
        serde_json::from_str(&raw).map_err(|e|e.to_string())
    }
    pub fn list(&self,kind:&str,query:&str)->Result<Vec<Value>>{
        let db=self.db.lock().map_err(|e|e.to_string())?;
        let mut statement=db.prepare("SELECT data FROM documents WHERE kind=?1 ORDER BY revision DESC").map_err(|e|e.to_string())?;
        let rows=statement.query_map([kind],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
        let mut values=vec![];
        let q=query.to_lowercase();
        // Trigram index accelerates substring queries of >=3 Unicode characters;
        // shorter searches retain Chinese single-character/word discoverability.
        let indexed:Option<Vec<String>>=if q.chars().count()>=3 {
            let escaped=format!("\"{}\"",q.replace('"',"\"\""));
            let mut search=db.prepare("SELECT id FROM search WHERE search MATCH ?1").map_err(|e|e.to_string())?;
            let ids=search.query_map([escaped],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string())?; Some(ids)
        }else{None};
        for row in rows {let value:Value=serde_json::from_str(&row.map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            if value["deleted"]==true{continue;}
            let matched=if q.is_empty(){true}else if let Some(ref ids)=indexed {ids.iter().any(|id|value["id"]==id.as_str())}else{["title","text","url","tags"].iter().any(|field|value[*field].to_string().to_lowercase().contains(&q))};
            if matched{values.push(value);}
        }Ok(values)
    }
    pub fn capture(&self, mut value: Value)->Result<Value>{
        if value["version"]!=2{return Err("内容格式不匹配，请更新浏览器扩展后重新收藏".into());}
        let url=value["url"].as_str().ok_or("Missing URL")?;
        let parsed=url::Url::parse(url).map_err(|e|e.to_string())?;
        if !["http","https"].contains(&parsed.scheme()){return Err("Only HTTP(S) pages can be archived".into());}
        for key in ["title","text"]{if !value[key].is_string(){return Err(format!("Missing {key}"));}}
        if value["tags"].is_null(){value["tags"]=json!([]);}
        let tags=value["tags"].as_array().ok_or("Tags must be an array")?;
        if tags.len()>100||tags.iter().any(|t|t.as_str().is_none_or(|s|s.trim().is_empty()||s.len()>100)){return Err("Invalid tags".into());}
        if let Some(folder)=value["folderId"].as_str(){
            if !self.list("folder","")?.iter().any(|f|f["id"]==folder){return Err("Folder does not exist".into());}
        }else if !value["folderId"].is_null(){return Err("Invalid folder".into());}
        if value["mode"]=="thread" && value["posts"].as_array().is_none_or(|p|p.is_empty()){return Err("未识别到帖子，收藏未保存".into());}
        let id=Uuid::new_v4().to_string();let dir=self.root.join("archives").join(&id);fs::create_dir_all(dir.join("assets")).map_err(|e|e.to_string())?;
        let resources=value["resources"].as_array().ok_or("Missing resources")?;
        for resource in resources {
            if resource["status"]=="saved" {
                let name=resource["name"].as_str().ok_or("Missing asset name")?;if !valid_asset(name){return Err("Invalid asset name".into());}
                let source=self.root.join("blobs").join(name);if !source.is_file(){return Err(format!("Asset not uploaded: {name}"));}
                let dest=dir.join("assets").join(name);if !dest.exists(){fs::hard_link(&source,&dest).or_else(|_|fs::copy(&source,&dest).map(|_|())).map_err(|e|e.to_string())?;}
            }
        }
        if value["platform"]=="web" {
            let content=value["content"].as_str().ok_or("Missing webpage content")?;
            atomic_write(&dir.join("content.html"),content.as_bytes())?;
        }
        value.as_object_mut().unwrap().remove("content");
        value["id"]=json!(id);if value.get("folderId").is_none(){value["folderId"]=Value::Null;}
        let saved=self.event("item",value)?;
        atomic_write(&dir.join("manifest.json"),&serde_json::to_vec_pretty(&saved).unwrap())?;
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn paths_reject_traversal(){assert!(!valid_asset("../config.json"));assert!(!valid_id("../../"));assert!(valid_asset(&format!("{}.png","a".repeat(64))));}
    #[test]fn search_replay_and_duplicates(){let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();
        let fixture=json!({"version":2,"platform":"web","title":"光电器件","text":"InSb diffusion research","url":"https://example.com","content":"<p>Hi</p>","resources":[],"posts":[]});
        let first=store.capture(fixture.clone()).unwrap();let second=store.capture(fixture).unwrap();assert_ne!(first["id"],second["id"]);
        assert_eq!(store.list("item","diffusion").unwrap().len(),2);assert_eq!(store.list("item","光电").unwrap().len(),2);
        drop(store);assert_eq!(Store::open(dir.path().to_path_buf()).unwrap().list("item","").unwrap().len(),2);
    }
    #[test]fn capture_keeps_destination_and_platform_tags(){
        let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();
        let folder=store.event("folder",json!({"name":"Reading"})).unwrap();
        let fixture=json!({"version":2,"platform":"web","title":"Video","text":"test","url":"https://example.com","content":"<p>Video</p>","resources":[],"posts":[],"folderId":folder["id"],"tags":["Research"]});
        let saved=store.capture(fixture.clone()).unwrap();assert_eq!(saved["folderId"],folder["id"]);assert_eq!(saved["tags"],json!(["Research"]));
        let mut bad=fixture;bad["folderId"]=json!(Uuid::new_v4());assert!(store.capture(bad).is_err());
        store.event("tag",json!({"name":"Videos","platform":"x"})).unwrap();drop(store);
        assert_eq!(Store::open(dir.path().to_path_buf()).unwrap().list("tag","").unwrap().len(),1);
    }
    #[test]fn posts_keep_one_structured_content_and_no_html(){
        let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();
        let saved=store.capture(json!({"version":2,"platform":"x","mode":"thread","title":"Post","text":"Body","url":"https://x.com/a/status/1","posts":[{"text":"Body"}],"resources":[]})).unwrap();
        let root=store.root.join("archives").join(saved["id"].as_str().unwrap());
        assert!(root.join("manifest.json").is_file());assert!(!root.join("content.html").exists());assert_eq!(fs::read_dir(root).unwrap().count(),2);
    }
    #[test]fn revision_order_is_deterministic(){let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();let id=Uuid::new_v4().to_string();
        let event=|rev:&str,title:&str|json!({"kind":"item","revision":rev,"data":{"id":id,"title":title}});
        store.index(&event("z","new")).unwrap();store.index(&event("a","old")).unwrap();assert_eq!(store.get(&id).unwrap()["title"],"new");
    }
}
