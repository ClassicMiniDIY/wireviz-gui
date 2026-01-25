/// Bill of Materials (BOM) data structures and parsing

#[derive(Debug, Clone, Default)]
pub struct Bom {
    pub items: Vec<BomItem>,
}

#[derive(Debug, Clone)]
pub struct BomItem {
    pub id: String,
    pub description: String,
    pub qty: String,
    pub unit: String,
    pub designators: String,
    pub manufacturer: String,
    pub mpn: String,
    pub supplier: String,
    pub spn: String,
    pub pn: String,
}

impl Bom {
    /// Parse BOM from TSV format
    pub fn from_tsv(tsv_content: &str) -> Result<Self, String> {
        let mut items = Vec::new();
        let mut lines = tsv_content.lines();

        // Skip header line
        if lines.next().is_none() {
            return Ok(Bom::default());
        }

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.split('\t').collect();

            if parts.len() >= 4 {
                items.push(BomItem {
                    id: parts.get(0).unwrap_or(&"").to_string(),
                    description: parts.get(1).unwrap_or(&"").to_string(),
                    qty: parts.get(2).unwrap_or(&"").to_string(),
                    unit: parts.get(3).unwrap_or(&"").to_string(),
                    designators: parts.get(4).unwrap_or(&"").to_string(),
                    manufacturer: parts.get(5).unwrap_or(&"").to_string(),
                    mpn: parts.get(6).unwrap_or(&"").to_string(),
                    supplier: parts.get(7).unwrap_or(&"").to_string(),
                    spn: parts.get(8).unwrap_or(&"").to_string(),
                    pn: parts.get(9).unwrap_or(&"").to_string(),
                });
            }
        }

        Ok(Bom { items })
    }

    /// Convert to CSV format
    pub fn to_csv(&self) -> String {
        let mut csv = String::from("ID,Description,Qty,Unit,Designators,Manufacturer,MPN,Supplier,SPN,P/N\n");

        for item in &self.items {
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{}\n",
                Self::escape_csv(&item.id),
                Self::escape_csv(&item.description),
                item.qty,
                Self::escape_csv(&item.unit),
                Self::escape_csv(&item.designators),
                Self::escape_csv(&item.manufacturer),
                Self::escape_csv(&item.mpn),
                Self::escape_csv(&item.supplier),
                Self::escape_csv(&item.spn),
                Self::escape_csv(&item.pn),
            ));
        }

        csv
    }

    fn escape_csv(s: &str) -> String {
        if s.contains(',') || s.contains('"') || s.contains('\n') {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    }

    /// Get total item count
    pub fn item_count(&self) -> usize {
        self.items.len()
    }
}
