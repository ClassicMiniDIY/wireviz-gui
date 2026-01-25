use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Document {
    pub id: usize,
    pub path: Option<PathBuf>,
    pub yaml_content: String,
    pub preview_svg: Option<String>,
    pub bom_data: Option<String>,
    pub dirty: bool,
    pub last_error: Option<String>,
}

impl Document {
    pub fn new(id: usize) -> Self {
        Self {
            id,
            path: None,
            yaml_content: String::new(),
            preview_svg: None,
            bom_data: None,
            dirty: false,
            last_error: None,
        }
    }

    pub fn from_file(id: usize, path: PathBuf, content: String) -> Self {
        Self {
            id,
            path: Some(path),
            yaml_content: content,
            preview_svg: None,
            bom_data: None,
            dirty: false,
            last_error: None,
        }
    }

    pub fn get_title(&self) -> String {
        if let Some(path) = &self.path {
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
                .to_string()
        } else {
            "untitled".to_string()
        }
    }

    pub fn get_display_title(&self) -> String {
        let mut title = self.get_title();
        if self.dirty {
            title.push('*');
        }
        title
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }
}
