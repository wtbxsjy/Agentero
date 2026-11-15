use super::*;
use std::fs;
use tempfile::tempdir;

const ID: &str = "p-20261115-021000-abc123";

fn make_base(dir: &Path) {
    fs::write(
        dir.join(CONFIG_FILE),
        "name: \"Ribo 知识库\"\ntopic: ribo\npaths:\n  raw: raw\n  wiki: wiki_Ribo  # 显示名\n  proposals: proposals\nllm:\n  model: x\n",
    )
    .unwrap();
    fs::create_dir_all(dir.join("proposals/pending")).unwrap();
    fs::create_dir_all(dir.join("proposals/decided")).unwrap();
}

fn proposal(id: &str, status: &str) -> String {
    format!(
        "{{\"schema_version\":1,\"id\":\"{id}\",\"kind\":\"new_page\",\"target\":\"wiki_Ribo/concepts/a.md\",\"patch\":{{\"frontmatter\":{{\"title\":\"A\"}},\"body\":\"x\"}},\"status\":\"{status}\"}}"
    )
}

#[test]
fn parses_config_name_and_paths() {
    let (name, paths) = parse_config(
        "name: 'It''s'\npaths:\n  wiki: \"wiki_X\"\n  raw: sources\ntopic: t\n  wiki: ignored\n",
    );
    assert_eq!(name.as_deref(), Some("It's"));
    assert_eq!(paths.wiki, "wiki_X");
    assert_eq!(paths.raw, "sources");
    assert_eq!(paths.proposals, "proposals");
}

#[test]
fn validates_proposal_ids() {
    assert!(is_proposal_id(ID));
    assert!(!is_proposal_id("p-20261115-021000-ABC123"));
    assert!(!is_proposal_id("p-2026111-021000-abc123"));
    assert!(!is_proposal_id("../p-20261115-021000-abc1"));
}

#[test]
fn lists_bases_in_vault_kb_folder() {
    let vault = tempdir().unwrap();
    let kb = vault.path().join("kb").join("Ribo");
    fs::create_dir_all(&kb).unwrap();
    make_base(&kb);
    fs::write(
        kb.join("proposals/pending").join(format!("{ID}.json")),
        "{}",
    )
    .unwrap();
    fs::create_dir_all(vault.path().join("kb/not-a-base")).unwrap();
    let bases = list_bases(vault.path());
    assert_eq!(bases.len(), 1);
    assert_eq!(bases[0].name, "Ribo 知识库");
    assert_eq!(bases[0].wiki_dir, "wiki_Ribo");
    assert_eq!(bases[0].pending, 1);
    assert!(!bases[0].has_merge);
}

#[test]
fn reads_and_edits_pending_proposals() {
    let kb = tempdir().unwrap();
    make_base(kb.path());
    let path = kb
        .path()
        .join("proposals/pending")
        .join(format!("{ID}.json"));
    fs::write(&path, proposal(ID, "pending")).unwrap();
    let files = read_proposals(kb.path(), ProposalState::Pending, None).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].id, ID);

    let edited = proposal(ID, "pending").replace("\"x\"", "\"y\"");
    write_pending_proposal(kb.path(), ID, &edited).unwrap();
    assert!(fs::read_to_string(&path).unwrap().contains("\"y\""));

    // id and status are frozen
    let other = proposal("p-20261115-021000-ffffff", "pending");
    assert!(write_pending_proposal(kb.path(), ID, &other).is_err());
    assert!(write_pending_proposal(kb.path(), ID, &proposal(ID, "accepted")).is_err());
    assert!(write_pending_proposal(kb.path(), ID, "{not json").is_err());

    // a decided proposal cannot be edited through the pending path
    fs::remove_file(&path).unwrap();
    assert!(write_pending_proposal(kb.path(), ID, &edited).is_err());
}

#[test]
fn read_base_file_refuses_escapes() {
    let kb = tempdir().unwrap();
    make_base(kb.path());
    assert!(read_base_file(kb.path(), "../secret.md").is_err());
    assert!(read_base_file(kb.path(), "/etc/passwd").is_err());
    assert_eq!(
        read_base_file(kb.path(), "wiki_Ribo/missing.md").unwrap(),
        None
    );
}

#[test]
fn parses_locators() {
    assert_eq!(parse_locator("¶12"), (Some(12), None));
    assert_eq!(parse_locator("^p3"), (Some(3), None));
    assert_eq!(parse_locator("p7"), (Some(7), None));
    assert_eq!(parse_locator("p.4"), (None, Some(4)));
    assert_eq!(parse_locator("page=9"), (None, Some(9)));
    assert_eq!(parse_locator("L10-20"), (None, None));
}

#[test]
fn finds_evidence_paragraph_by_anchor() {
    let page = "---\nid: evidence-x\n---\n# T\n\n> header ^p1 mention\n\nFirst para. ^p1\n\nSecond\nline two. ^p2\n\nThird ^p12\n";
    assert_eq!(evidence_paragraph(page, 1).as_deref(), Some("First para."));
    assert_eq!(
        evidence_paragraph(page, 2).as_deref(),
        Some("Second\nline two.")
    );
    assert_eq!(evidence_paragraph(page, 12).as_deref(), Some("Third"));
    assert_eq!(evidence_paragraph(page, 3), None);
}

#[test]
fn numbers_raw_paragraphs_like_kb_template() {
    let raw = "---\nid: r\n---\n# Title\n\nIntro text.\n\n![fig](images/a.png)\n\n| a | b |\n\n|---|---|\n\nResults here.\n\n\n\nLast one.";
    // citable: "Intro text." (1), "| a | b |" (2, a table row is citable),
    // "Results here." (3), "Last one." (4); the image line is emptied by the
    // image strip and the separator row is skipped.
    assert_eq!(raw_paragraph(raw, 1).as_deref(), Some("Intro text."));
    assert_eq!(raw_paragraph(raw, 3).as_deref(), Some("Results here."));
    assert_eq!(raw_paragraph(raw, 4).as_deref(), Some("Last one."));
}

#[test]
fn resolves_evidence_from_raw_record_and_pdf() {
    let kb = tempdir().unwrap();
    make_base(kb.path());
    let raw_dir = kb.path().join("raw/paper");
    fs::create_dir_all(&raw_dir).unwrap();
    fs::create_dir_all(kb.path().join("attachments")).unwrap();
    fs::write(kb.path().join("attachments/ingolia.pdf"), b"%PDF-1.4").unwrap();
    fs::write(
        raw_dir.join("some-file.md"),
        "---\nid: ingolia2009\ntitle: \"Genome-wide analysis\"\nsource_path: attachments/ingolia.pdf\n---\n# H\n\nOne.\n\nTwo.\n\nThree.\n",
    )
    .unwrap();
    let ev = resolve_evidence(kb.path(), "ingolia2009", Some("¶2"), None).unwrap();
    assert_eq!(ev.paragraph, Some(2));
    assert_eq!(ev.text.as_deref(), Some("Two."));
    assert_eq!(ev.raw_title.as_deref(), Some("Genome-wide analysis"));
    assert!(ev.pdf_path.unwrap().ends_with("ingolia.pdf"));
    assert!(ev.evidence_path.is_none());

    // the evidence page wins over the raw body when present
    let evd = kb.path().join("wiki_Ribo/evidence");
    fs::create_dir_all(&evd).unwrap();
    fs::write(
        evd.join("evidence-ingolia2009.md"),
        "# x\n\nOne. ^p1\n\nTwo from page. ^p2\n",
    )
    .unwrap();
    let ev = resolve_evidence(kb.path(), "ingolia2009", Some("¶2"), None).unwrap();
    assert_eq!(ev.text.as_deref(), Some("Two from page."));
    assert!(ev.evidence_path.is_some());

    assert!(resolve_evidence(kb.path(), "../x", None, None).is_err());
}

#[test]
fn builds_search_quotes_from_markdown() {
    let para = "Ribosome **footprints** show strong three-nucleotide periodicity ($3$-nt), see [[ribo-seq|Ribo-seq]] and [docs](http://x). <sup>12</sup>";
    let q = quote_candidates(para);
    assert_eq!(
        q[0],
        "Ribosome footprints show strong three-nucleotide periodicity ( -nt), see Ribo-seq and docs. 12"
    );
    assert!(q.iter().all(|s| !s.contains("**") && !s.contains("http")));
    assert!(tail_quote(para).is_none());
}

#[test]
fn strips_mineru_inline_images() {
    assert_eq!(
        strip_inline_images("a ![x](images/1.png) b ![y](http://u) c"),
        "a  b ![y](http://u) c"
    );
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[test]
fn locates_evidence_paragraph_in_pdf() {
    let kb = tempdir().unwrap();
    make_base(kb.path());
    let pdf = kb.path().join("paper.pdf");
    fs::write(
        &pdf,
        crate::features::pdf::tiny_pdf("Ribosome footprints show periodicity"),
    )
    .unwrap();
    let hit = locate_evidence_in_pdf(&pdf, "Ribosome **footprints** show periodicity.", None)
        .expect("paragraph located");
    assert_eq!(hit.page_index, 0);
    assert!(hit.w > 0.1 && hit.h > 0.0, "implausible rect {hit:?}");
    assert!(hit.y < 0.5, "expected the upper half, got {}", hit.y);

    assert!(locate_evidence_in_pdf(&pdf, "Completely different sentence here", None).is_none());
}

#[test]
fn reads_template_dir_and_forwarders() {
    assert_eq!(
        parse_template_dir("name: x\ntemplate_dir: \"/src/kb-template\"\npaths:\n  wiki: w\n")
            .as_deref(),
        Some("/src/kb-template")
    );
    assert_eq!(parse_template_dir("template_dir: ~\n"), None);
    assert_eq!(parse_template_dir("paths:\n  template_dir: x\n"), None);
    let d = tempdir().unwrap();
    make_base(d.path());
    fs::create_dir_all(d.path().join("R")).unwrap();
    fs::write(
        d.path().join("R/kb_merge.R"),
        "#!/usr/bin/env Rscript\n## kb-template forwarder (kb_init --scripts shared)\n",
    )
    .unwrap();
    fs::write(
        d.path().join(CONFIG_FILE),
        "name: a\ntemplate_dir: /src/kb-template\npaths:\n  wiki: wiki_Ribo\n",
    )
    .unwrap();
    let b = describe(d.path()).unwrap();
    assert!(b.has_merge && b.shared_scripts);
    assert_eq!(b.template_dir.as_deref(), Some("/src/kb-template"));
}

#[test]
fn finds_wiki_targets() {
    let d = tempdir().unwrap();
    make_base(d.path());
    let root = d.path().to_path_buf();
    assert_eq!(
        kb_wiki_target(&root.join("wiki_Ribo/concepts/new.md")),
        Some(root.clone())
    );
    assert_eq!(kb_wiki_target(&root.join("raw/x.md")), None);
    assert_eq!(kb_wiki_target(&root.join("proposals/pending/p.json")), None);
    assert_eq!(
        kb_wiki_target(&root.join("raw/../wiki_Ribo/a.md")),
        Some(root.clone())
    );
    assert_eq!(kb_wiki_target(Path::new("wiki_Ribo/a.md")), None);
    let outside = tempdir().unwrap();
    assert_eq!(kb_wiki_target(&outside.path().join("wiki_Ribo/a.md")), None);
}
