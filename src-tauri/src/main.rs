#![cfg_attr(not(debug_assertions),windows_subsystem="windows")]
use tauri::Manager;
#[tauri::command]
fn connection(state:tauri::State<'_,glassmark_core::AppState>)->serde_json::Value{state.connection()}
fn main(){
    tauri::Builder::default().setup(|app|{
        let root=app.path().app_data_dir()?;
        let state=glassmark_core::AppState::open(root).map_err(std::io::Error::other)?;
        app.manage(state.clone());
        tauri::async_runtime::spawn(async move{if let Err(error)=glassmark_core::serve(state).await{eprintln!("{error}");}});
        Ok(())
    }).invoke_handler(tauri::generate_handler![connection]).run(tauri::generate_context!()).expect("run Glassmark desktop");
}
