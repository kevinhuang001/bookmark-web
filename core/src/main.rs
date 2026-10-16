#[tokio::main]
async fn main(){
    let root=std::env::var_os("GLASSMARK_DATA").map(std::path::PathBuf::from).unwrap_or_else(||std::path::PathBuf::from(".glassmark"));
    let state=glassmark_core::AppState::open(root).expect("open data directory");
    if let Some(path)=std::env::var_os("GLASSMARK_CONNECTION_FILE"){std::fs::write(path,state.connection().to_string()).expect("write connection file");}
    println!("Glassmark bridge listening on 127.0.0.1:{}",glassmark_core::PORT);
    glassmark_core::serve(state).await.expect("start local bridge");
}
