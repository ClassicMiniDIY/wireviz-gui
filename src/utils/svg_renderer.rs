use anyhow::Result;
use tiny_skia::Pixmap;

pub struct SvgRenderer;

impl Default for SvgRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl SvgRenderer {
    pub fn new() -> Self {
        Self
    }

    pub fn render_to_pixmap(&self, svg_content: &str) -> Result<Pixmap> {
        // Parse SVG with default options
        let tree = resvg::usvg::Tree::from_str(svg_content, &resvg::usvg::Options::default())?;

        // Get SVG dimensions
        let size = tree.size();
        let width = size.width().ceil() as u32;
        let height = size.height().ceil() as u32;

        // Create pixmap
        let mut pixmap = Pixmap::new(width, height)
            .ok_or_else(|| anyhow::anyhow!("Failed to create pixmap"))?;

        // Render
        resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());

        Ok(pixmap)
    }

    pub fn render_to_rgba(&self, svg_content: &str) -> Result<(Vec<u8>, u32, u32)> {
        let pixmap = self.render_to_pixmap(svg_content)?;
        let width = pixmap.width();
        let height = pixmap.height();
        let data = pixmap.data().to_vec();

        Ok((data, width, height))
    }
}
