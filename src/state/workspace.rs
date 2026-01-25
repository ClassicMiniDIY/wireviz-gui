use crate::state::Document;
use anyhow::Result;
use std::path::PathBuf;

pub struct Workspace {
    documents: Vec<Document>,
    active_document_id: Option<usize>,
    next_id: usize,
}

impl Workspace {
    pub fn new() -> Self {
        Self {
            documents: Vec::new(),
            active_document_id: None,
            next_id: 0,
        }
    }

    pub fn new_document(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;

        let doc = Document::new(id);
        self.documents.push(doc);
        self.active_document_id = Some(id);
        id
    }

    pub fn open_document(&mut self, path: PathBuf) -> Result<usize> {
        let content = std::fs::read_to_string(&path)?;
        let id = self.next_id;
        self.next_id += 1;

        let doc = Document::from_file(id, path, content);
        self.documents.push(doc);
        self.active_document_id = Some(id);
        Ok(id)
    }

    pub fn close_document(&mut self, id: usize) {
        self.documents.retain(|d| d.id != id);
        if self.active_document_id == Some(id) {
            self.active_document_id = self.documents.first().map(|d| d.id);
        }
    }

    pub fn get_active_document(&self) -> Option<&Document> {
        self.active_document_id
            .and_then(|id| self.documents.iter().find(|d| d.id == id))
    }

    pub fn get_active_document_mut(&mut self) -> Option<&mut Document> {
        self.active_document_id
            .and_then(|id| self.documents.iter_mut().find(|d| d.id == id))
    }

    pub fn set_active_document(&mut self, id: usize) {
        if self.documents.iter().any(|d| d.id == id) {
            self.active_document_id = Some(id);
        }
    }

    pub fn get_documents(&self) -> &[Document] {
        &self.documents
    }

    pub fn save_current_document(&mut self) -> Result<()> {
        if let Some(doc) = self.get_active_document_mut() {
            if let Some(path) = &doc.path {
                std::fs::write(path, &doc.yaml_content)?;
                doc.mark_clean();
                Ok(())
            } else {
                Err(anyhow::anyhow!("No file path set"))
            }
        } else {
            Err(anyhow::anyhow!("No active document"))
        }
    }

    pub fn save_current_document_as(&mut self, path: PathBuf) -> Result<()> {
        if let Some(doc) = self.get_active_document_mut() {
            std::fs::write(&path, &doc.yaml_content)?;
            doc.path = Some(path);
            doc.mark_clean();
            Ok(())
        } else {
            Err(anyhow::anyhow!("No active document"))
        }
    }

    pub fn has_documents(&self) -> bool {
        !self.documents.is_empty()
    }
}
