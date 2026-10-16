#![cfg_attr(not(debug_assertions),windows_subsystem="windows")]
use tauri::Manager;
#[tauri::command]
fn connection(state:tauri::State<'_,glassmark_core::AppState>)->serde_json::Value{state.connection()}
// The compositor must clip the native material too; CSS only clips the WebView.
#[cfg(target_os="windows")]
fn configure_corners(window:&tauri::WebviewWindow){
    use std::ffi::c_void;
    #[link(name="dwmapi")]
    unsafe extern "system" {fn DwmSetWindowAttribute(hwnd:*mut c_void,attribute:u32,value:*const c_void,size:u32)->i32;}
    if let Ok(hwnd)=window.hwnd(){
        let rounded:u32=2;let no_border:u32=0xfffffffe;
        unsafe {
            DwmSetWindowAttribute(hwnd.0 as *mut c_void,33,&rounded as *const _ as *const c_void,4);
            DwmSetWindowAttribute(hwnd.0 as *mut c_void,34,&no_border as *const _ as *const c_void,4);
        }
    }
}
fn main(){
    tauri::Builder::default().setup(|app|{
        #[cfg(target_os="windows")]
        if let Some(window)=app.get_webview_window("main"){configure_corners(&window);}
        let root=app.path().app_data_dir()?;
        let state=glassmark_core::AppState::open(root).map_err(std::io::Error::other)?;
        app.manage(state.clone());
        tauri::async_runtime::spawn(async move{if let Err(error)=glassmark_core::serve(state).await{eprintln!("{error}");}});
        Ok(())
    }).invoke_handler(tauri::generate_handler![connection]).run(tauri::generate_context!()).expect("run Glassmark desktop");
}
