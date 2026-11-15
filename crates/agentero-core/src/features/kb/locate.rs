//! Evidence paragraph → PDF rect, through the shared PDFium text locator.

use super::{quote_candidates, tail_quote, EvidenceRect};
use crate::features::pdf::locate::{locate_in_pdf, LocateRequest, NormRect};
use std::path::Path;

pub type PdfEvidenceHit = EvidenceRect;

fn union(rects: &[NormRect]) -> Option<(f32, f32, f32, f32)> {
    let first = rects.first()?;
    let (mut x0, mut y0) = (first.x, first.y);
    let (mut x1, mut y1) = (first.x + first.w, first.y + first.h);
    for r in &rects[1..] {
        x0 = x0.min(r.x);
        y0 = y0.min(r.y);
        x1 = x1.max(r.x + r.w);
        y1 = y1.max(r.y + r.h);
    }
    Some((x0, y0, x1 - x0, y1 - y0))
}

/// Find `paragraph` in the PDF. Tries progressively shorter quotes from the
/// paragraph head; when the head is found, also looks for the paragraph tail
/// on the same or next page so the highlight covers the whole paragraph.
/// `page_hint` (1-based) is searched first when given.
pub fn locate_evidence_in_pdf(
    pdf_path: &Path,
    paragraph: &str,
    page_hint: Option<u32>,
) -> Option<PdfEvidenceHit> {
    let pdf = std::fs::read(pdf_path).ok()?;
    for quote in quote_candidates(paragraph) {
        let req = LocateRequest {
            quote: quote.clone(),
            page: page_hint,
            case_sensitive: false,
            max_matches: 2,
            measure_pages: Vec::new(),
        };
        let Ok(found) = locate_in_pdf(&pdf, &req) else {
            continue;
        };
        let Some(head) = found.matches.first() else {
            continue;
        };
        let Some((mut x, mut y, mut w, mut h)) = union(&head.rects) else {
            continue;
        };
        if let Some(tail) = tail_quote(paragraph) {
            let req = LocateRequest {
                quote: tail,
                page: Some(head.page),
                case_sensitive: false,
                max_matches: 2,
                measure_pages: Vec::new(),
            };
            let tail_rect = locate_in_pdf(&pdf, &req).ok().and_then(|r| {
                r.matches
                    .into_iter()
                    .find(|m| m.page == head.page && m.char_index > head.char_index)
                    .and_then(|m| union(&m.rects))
            });
            // Same page and below the head: grow the box over the paragraph.
            // Two-column layouts can put the tail in the other column; cap the
            // growth so one bad match cannot cover the whole page.
            if let Some((tx, ty, tw, th)) = tail_rect {
                let (nx0, ny0) = (x.min(tx), y.min(ty));
                let (nx1, ny1) = ((x + w).max(tx + tw), (y + h).max(ty + th));
                if ny1 - ny0 < 0.6 {
                    (x, y, w, h) = (nx0, ny0, nx1 - nx0, ny1 - ny0);
                }
            }
        }
        return Some(EvidenceRect {
            page_index: head.page.saturating_sub(1),
            x,
            y,
            w,
            h,
            matched: quote,
        });
    }
    None
}
