mod app;
mod state;
mod ui;
mod utils;
mod wireviz;

use app::WireVizApp;

fn main() -> eframe::Result<()> {
    // Configure logging
    env_logger::init();

    // Configure native options
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1400.0, 900.0])
            .with_min_inner_size([800.0, 600.0])
            .with_title("WireViz GUI"),
        ..Default::default()
    };

    // Run the app
    eframe::run_native(
        "WireViz GUI",
        native_options,
        Box::new(|cc| Ok(Box::new(WireVizApp::new(cc)))),
    )
}
