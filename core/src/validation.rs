use crate::store::Result;
use serde_json::Value;
pub fn tags(value:&Value)->Result<()>{
    let tags=value.as_array().ok_or("Tags must be an array")?;
    if tags.len()>100||tags.iter().any(|tag|tag.as_str().is_none_or(|s|s.trim().is_empty()||s.len()>100)){
        return Err("Invalid tags".into());
    }
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    use serde_json::json;
    #[test]fn rejects_invalid_tags_for_both_capture_and_updates(){
        for value in [json!(null),json!([1]),json!([""]),json!(["   "]),json!(["x".repeat(101)])]{assert!(tags(&value).is_err());}
        assert!(tags(&json!(["Research","研究"])).is_ok());
    }
}
