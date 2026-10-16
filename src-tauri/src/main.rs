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
// Clip the common AppKit ancestor, not only the HTML or NSVisualEffectView.
// The WebView and native frosted material are siblings beneath this surface.
#[cfg(target_os="macos")]
fn configure_corners(window:&tauri::WebviewWindow){
    use objc2::{msg_send, runtime::{AnyObject, Bool}};
    let Ok(raw)=window.ns_window() else {return};
    let radius:f64=if window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false){0.0}else{20.0};
    unsafe {
        let native=&*(raw as *mut AnyObject);
        let _:()=msg_send![native, setOpaque:Bool::NO];
        let content:*mut AnyObject=msg_send![native, contentView];
        if content.is_null(){return;}
        let frame:*mut AnyObject=msg_send![content, superview];
        for view in [content,frame] {
            if view.is_null(){continue;}
            let _:()=msg_send![view, setWantsLayer:Bool::YES];
            let layer:*mut AnyObject=msg_send![view, layer];
            if !layer.is_null(){
                let _:()=msg_send![layer, setCornerRadius:radius];
                let _:()=msg_send![layer, setMasksToBounds:Bool::YES];
            }
        }
        let _:()=msg_send![native, invalidateShadow];
    }
}
fn main(){
    tauri::Builder::default().setup(|app|{
        #[cfg(any(target_os="windows",target_os="macos"))]
        if let Some(window)=app.get_webview_window("main"){configure_corners(&window);}
        let root=app.path().app_data_dir()?;
        let state=glassmark_core::AppState::open(root).map_err(std::io::Error::other)?;
        app.manage(state.clone());
        tauri::async_runtime::spawn(async move{if let Err(error)=glassmark_core::serve(state).await{eprintln!("{error}");}});
        Ok(())
    }).on_window_event(|window,event|{
        #[cfg(target_os="macos")]
        if matches!(event,tauri::WindowEvent::Resized(_)){
            if let Some(webview)=window.app_handle().get_webview_window(window.label()){
                configure_corners(&webview);
            }
        }
        #[cfg(not(target_os="macos"))]
        let _=(window,event);
    }).invoke_handler(tauri::generate_handler![connection]).run(tauri::generate_context!()).expect("run Glassmark desktop");
}
