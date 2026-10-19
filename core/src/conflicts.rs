//! Causal heads retain concurrent edits for explicit resolution, independent of clocks.
use crate::store::{atomic_write, now, valid_id, Result, Store};
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

fn revision_name(value: &str) -> bool {
    !value.is_empty() && value.len() < 100 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
pub fn validate_event(event: &Value) -> Result<()> {
    if event["version"] != 2 || !event["parents"].is_array() || !event["data"].is_object()
        || !valid_id(event["data"]["id"].as_str().ok_or("Missing id")?)
        || !["item", "folder", "tag"].contains(&event["kind"].as_str().unwrap_or(""))
        || !revision_name(event["revision"].as_str().unwrap_or("")) {
        return Err("Invalid sync event".into());
    }
    if let Some(parents) = event.get("parents") {
        let mut unique = BTreeSet::new();
        for parent in parents.as_array().ok_or("Invalid revision parents")? {
            let p = parent.as_str().ok_or("Invalid revision parent")?;
            if !revision_name(p) || parent == &event["revision"] || !unique.insert(p) {
                return Err("Invalid revision parent".into());
            }
        }
    }
    Ok(())
}
impl Store {
    pub(crate) fn event_unlocked(&self, kind: &str, mut data: Value, parents: Option<Vec<String>>) -> Result<Value> {
        if !data.is_object() { return Err("Invalid document".into()); }
        if data["id"].as_str().is_none() { data["id"] = json!(Uuid::new_v4().to_string()); }
        let base = data.as_object_mut().unwrap().remove("revision").and_then(|v| v.as_str().map(str::to_owned));
        let parents = match (parents, base) {
            (Some(parents), _) => parents,
            (None, Some(base)) => vec![base],
            (None, None) => {
                let db = self.db.lock().map_err(|e| e.to_string())?;
                db.query_row("SELECT revision FROM documents WHERE id=?1", [data["id"].as_str().unwrap()], |r| r.get::<_, String>(0)).ok().into_iter().collect()
            }
        };
        data["modifiedAt"] = json!(now());
        let revision = format!("{}--{}", chrono::Utc::now().format("%Y%m%dT%H%M%S%9f"), Uuid::new_v4());
        let event = json!({"version":2,"revision":revision,"parents":parents,"device":self.device,"kind":kind,"data":data});
        validate_event(&event)?;
        let path = self.root.join("events").join(format!("{revision}.json"));
        atomic_write(&path, &serde_json::to_vec_pretty(&event).unwrap())?;
        if let Err(error) = self.index_unlocked(&event) { let _ = std::fs::remove_file(path); return Err(error); }
        let mut saved = event["data"].clone(); saved["revision"] = json!(revision); Ok(saved)
    }
    pub(crate) fn index_unlocked(&self, event: &Value) -> Result<()> {
        validate_event(event)?;
        let id = event["data"]["id"].as_str().unwrap();
        let revision = event["revision"].as_str().unwrap();
        let kind = event["kind"].as_str().unwrap();
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let prior: Option<String> = tx.query_row("SELECT event FROM revisions WHERE revision=?1", [revision], |r| r.get(0)).ok();
        if prior.map(|s| serde_json::from_str::<Value>(&s)).transpose().map_err(|e|e.to_string())?.is_some_and(|prior|prior != *event) { return Err("远端同步事件不一致，已停止同步".into()); }
        let prior_kind: Option<String> = tx.query_row("SELECT kind FROM documents WHERE id=?1", [id], |r| r.get(0)).ok();
        if prior_kind.is_some_and(|previous| previous != kind) { return Err("Document kind changed".into()); }
        if let Some(parents) = event["parents"].as_array() {
            for parent in parents {
                let owner: Option<String> = tx.query_row("SELECT id FROM revisions WHERE revision=?1", [parent.as_str().unwrap()], |r| r.get(0)).ok();
                if owner.is_some_and(|owner| owner != id) { return Err("Invalid revision parent".into()); }
            }
        }
        tx.execute("INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3)", params![revision,id,event.to_string()]).map_err(|e|e.to_string())?;
        let events: BTreeMap<String, Value> = {
            let mut stmt = tx.prepare("SELECT revision,event FROM revisions WHERE id=?1 ORDER BY revision").map_err(|e|e.to_string())?;
            let rows = stmt.query_map([id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
            let mut events = BTreeMap::new();
            for row in rows { let (revision,raw) = row.map_err(|e|e.to_string())?; events.insert(revision,serde_json::from_str(&raw).map_err(|e|e.to_string())?); }
            events
        };
        let mut ancestors = BTreeSet::new();
        for old in events.values() {
            for parent in old["parents"].as_array().ok_or("Invalid revision parents")? {
                ancestors.insert(parent.as_str().ok_or("Invalid revision parent")?.to_owned());
            }
        }
        let heads: Vec<_> = events.iter().filter(|(rev,_)|!ancestors.contains(*rev)).collect();
        let (winner, selected) = heads.iter().rev().find(|(_,e)|e["data"]["deleted"]!=true).or_else(||heads.last()).ok_or("Invalid revision cycle")?;
        tx.execute("DELETE FROM heads WHERE id=?1", [id]).map_err(|e|e.to_string())?;
        for (rev,_) in &heads { tx.execute("INSERT INTO heads VALUES(?1,?2)",params![id,rev]).map_err(|e|e.to_string())?; }
        let mut data = selected["data"].clone(); data["revision"] = json!(winner);
        tx.execute("INSERT OR REPLACE INTO documents VALUES(?1,?2,?3,?4)", params![id,winner,kind,data.to_string()]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM search WHERE id=?1",[id]).map_err(|e|e.to_string())?;
        if kind == "item" && data["deleted"] != true {
            tx.execute("INSERT INTO search VALUES(?1,?2,?3,?4,?5)",params![id,data["title"].as_str().unwrap_or(""),data["text"].as_str().unwrap_or(""),data["url"].as_str().unwrap_or(""),data["tags"].to_string()]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())?; Ok(())
    }
    pub fn conflict_count(&self) -> Result<usize> {
        self.db.lock().map_err(|e|e.to_string())?.query_row("SELECT count(*) FROM (SELECT id FROM heads GROUP BY id HAVING count(*)>1)",[],|r|r.get(0)).map_err(|e|e.to_string())
    }
    pub fn conflicts(&self) -> Result<Vec<Value>> {
        let db = self.db.lock().map_err(|e|e.to_string())?;
        let mut stmt = db.prepare("SELECT r.id,r.event,d.revision FROM heads h JOIN revisions r ON h.revision=r.revision JOIN documents d ON d.id=r.id WHERE r.id IN (SELECT id FROM heads GROUP BY id HAVING count(*)>1) ORDER BY r.id,r.revision DESC").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
        let mut groups: BTreeMap<String,Value> = BTreeMap::new();
        for row in rows {
            let (id,raw,current) = row.map_err(|e|e.to_string())?;
            let event: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
            let group = groups.entry(id.clone()).or_insert_with(||json!({"id":id,"kind":event["kind"],"versions":[]}));
            group["versions"].as_array_mut().unwrap().push(json!({"revision":event["revision"],"data":event["data"],"device":event["device"],"current":event["revision"]==current}));
        }
        Ok(groups.into_values().collect())
    }
    pub fn resolve_conflict(&self, id: &str, expected: &[String], choice: &str, merge_tags: bool) -> Result<Value> {
        let _guard = self.writes.lock().map_err(|e|e.to_string())?;
        let conflict = self.conflicts()?.into_iter().find(|c|c["id"]==id).ok_or("冲突已变更，请刷新后重试")?;
        let versions = conflict["versions"].as_array().unwrap();
        let actual: BTreeSet<String> = versions.iter().map(|v|v["revision"].as_str().unwrap().to_owned()).collect();
        let expected_set: BTreeSet<String> = expected.iter().cloned().collect();
        if actual != expected_set || actual.len() != expected.len() { return Err("冲突已变更，请刷新后重试".into()); }
        let mut data = versions.iter().find(|v|v["revision"]==choice).ok_or("Invalid conflict choice")?["data"].clone();
        if merge_tags {
            if conflict["kind"] != "item" || versions.iter().any(|v|v["data"]["deleted"]==true || v["data"]["title"]!=data["title"] || v["data"]["folderId"]!=data["folderId"]) { return Err("这些版本不能自动合并标签，请选择一个版本".into()); }
            let tags: BTreeSet<&str> = versions.iter().filter_map(|v|v["data"]["tags"].as_array()).flatten().filter_map(Value::as_str).collect();
            data["tags"] = json!(tags);
        }
        if conflict["kind"] == "folder" && data["deleted"] != true {
            let mut seen = BTreeSet::from([id.to_owned()]);
            let mut parent = data["parentId"].as_str().map(str::to_owned);
            while let Some(p) = parent {
                if !seen.insert(p.clone()) { return Err("文件夹不能包含自身或形成循环".into()); }
                parent = self.get(&p)?["parentId"].as_str().map(str::to_owned);
            }
        }
        self.event_unlocked(conflict["kind"].as_str().unwrap(),data,Some(actual.into_iter().collect()))
    }
}
#[cfg(test)]mod tests {
    use super::*;
    #[test]fn causal_heads_override_clock_order_and_reject_stale_resolution(){
        let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();let id=Uuid::new_v4().to_string();
        let event=|revision:&str,parents:Value,name:&str|json!({"version":2,"revision":revision,"kind":"folder","parents":parents,"data":{"id":id,"name":name}});
        let root=event("z",json!([]),"Root");let left=event("a",json!(["z"]),"Left");let right=event("b",json!(["z"]),"Right");
        store.index(&left).unwrap();store.index(&root).unwrap();assert_eq!(store.get(&id).unwrap()["name"],"Left");store.index(&right).unwrap();assert_eq!(store.conflict_count().unwrap(),1);
        assert!(store.resolve_conflict(&id,&["a".into()],"a",false).is_err());store.resolve_conflict(&id,&["a".into(),"b".into()],"a",false).unwrap();assert_eq!(store.get(&id).unwrap()["name"],"Left");store.index(&right).unwrap();assert_eq!(store.conflict_count().unwrap(),0);
    }
    #[test]fn unresolved_conflicts_and_resolutions_survive_restart(){
        let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();let base=store.event("folder",json!({"name":"Root"})).unwrap();let id=base["id"].as_str().unwrap().to_owned();
        let mut left=base.clone();left["name"]=json!("Left");store.event("folder",left).unwrap();let mut right=base;right["name"]=json!("Right");store.event("folder",right).unwrap();drop(store);
        let store=Store::open(dir.path().to_path_buf()).unwrap();assert_eq!(store.conflict_count().unwrap(),1);let conflict=store.conflicts().unwrap().remove(0);let heads:Vec<String>=conflict["versions"].as_array().unwrap().iter().map(|v|v["revision"].as_str().unwrap().to_owned()).collect();store.resolve_conflict(&id,&heads,&heads[0],false).unwrap();drop(store);assert_eq!(Store::open(dir.path().to_path_buf()).unwrap().conflict_count().unwrap(),0);
    }
}

#[cfg(test)]mod format_tests {
    use super::*;
    #[test]
    fn obsolete_history_without_explicit_causal_parents_is_rejected() {
        let mut event=json!({"version":2,"revision":"a","kind":"folder","parents":[],"data":{"id":Uuid::new_v4().to_string(),"name":"A"}});
        assert!(validate_event(&event).is_ok());
        event.as_object_mut().unwrap().remove("parents");
        assert!(validate_event(&event).is_err());
        event["parents"]=json!([]);
        event["version"]=json!(1);
        assert!(validate_event(&event).is_err());
    }
}
