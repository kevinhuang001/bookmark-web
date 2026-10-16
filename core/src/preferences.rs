use crate::store::{atomic_write,Result,Store};
use serde::{Deserialize,Serialize};
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase",deny_unknown_fields)]
pub struct Preferences {
 pub language:String,pub resolved_language:Option<String>,
 pub max_posts:u32,pub auto_load_seconds:u32,pub download_limit_mb:u32,pub download_concurrency:u32,
 pub image_timeout_seconds:u32,pub video_timeout_seconds:u32,pub resource_limit:u32,
 pub include_images:bool,pub include_avatars:bool,pub include_videos:bool,
 pub show_saved_time:bool,pub show_media_stats:bool,pub confirm_delete:bool,pub default_folder_id:Option<String>,pub visible_platforms:Vec<String>
}
impl Default for Preferences{fn default()->Self{Self{language:"system".into(),resolved_language:None,max_posts:100,auto_load_seconds:20,download_limit_mb:500,download_concurrency:6,image_timeout_seconds:15,video_timeout_seconds:90,resource_limit:2000,include_images:true,include_avatars:true,include_videos:true,show_saved_time:true,show_media_stats:true,confirm_delete:true,default_folder_id:None,visible_platforms:vec!["web".into(),"x".into(),"reddit".into(),"xiaohongshu".into()]}}}
impl Preferences {
 pub fn read(store:&Store)->Self{std::fs::read(store.root.join("preferences.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default()}
 pub fn validate(&self)->Result<()> {
  if !["system","en","zh-CN","ja"].contains(&self.language.as_str()) || self.resolved_language.as_deref().is_some_and(|l|!["en","zh-CN","ja"].contains(&l)){return Err("Invalid language".into());}
  for(name,value,min,max)in[("帖子数量",self.max_posts,1,1000),("自动加载秒数",self.auto_load_seconds,1,120),("下载上限 MB",self.download_limit_mb,10,20480),("并发数",self.download_concurrency,1,12),("图片超时",self.image_timeout_seconds,3,120),("视频超时",self.video_timeout_seconds,10,600),("资源数量",self.resource_limit,10,10000)]{if value<min||value>max{return Err(format!("{name}需要在 {min}–{max} 之间"));}}
  if self.visible_platforms.iter().any(|p|!["web","x","reddit","xiaohongshu"].contains(&p.as_str())) {return Err("未知平台".into());}
  Ok(())
 }
 pub fn save(&self,store:&Store)->Result<()>{self.validate()?;if let Some(id)=&self.default_folder_id{if !store.list("folder","")?.iter().any(|f|f["id"]==*id){return Err("默认文件夹不存在".into());}}atomic_write(&store.root.join("preferences.json"),&serde_json::to_vec(self).unwrap())}
}
#[cfg(test)]mod tests{use super::*;#[test]fn validates_parallel_download_limits(){let mut p=Preferences::default();assert!(p.validate().is_ok());p.download_concurrency=0;assert!(p.validate().is_err());p.download_concurrency=13;assert!(p.validate().is_err());}}

#[cfg(test)]mod platform_tests{use super::*;
 #[test]fn missing_platform_choices_use_all_sources(){let p:Preferences=serde_json::from_str(r#"{"maxPosts":42}"#).unwrap();assert_eq!(p.max_posts,42);assert_eq!(p.visible_platforms,vec!["web","x","reddit","xiaohongshu"]);}
 #[test]fn platform_choices_round_trip_and_validate(){let mut p=Preferences{visible_platforms:vec!["xiaohongshu".into()],..Preferences::default()};let saved=serde_json::to_vec(&p).unwrap();let restored:Preferences=serde_json::from_slice(&saved).unwrap();assert_eq!(restored.visible_platforms,p.visible_platforms);assert!(restored.validate().is_ok());p.visible_platforms.push("unknown".into());assert!(p.validate().is_err());}
}

#[cfg(test)]mod language_tests{use super::*;
 #[test]fn language_defaults_to_system_and_rejects_unknown_values(){let mut p:Preferences=serde_json::from_str("{}").unwrap();assert_eq!(p.language,"system");for locale in ["en","zh-CN","ja"]{p.language=locale.into();assert!(p.validate().is_ok());let restored:Preferences=serde_json::from_slice(&serde_json::to_vec(&p).unwrap()).unwrap();assert_eq!(restored.language,locale);}p.language="unknown".into();assert!(p.validate().is_err());p.language="en".into();p.resolved_language=Some("unknown".into());assert!(p.validate().is_err());}
}
