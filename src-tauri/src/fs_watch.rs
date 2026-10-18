//! Non-recursive watches on the folders a window shows and on each project's
//! git metadata, so the explorer and git panes react to the filesystem
//! instead of polling. Recursive watches are avoided on purpose: inotify
//! registers every directory under `node_modules`/`target` and runs out of
//! watches on large checkouts.

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

pub const CHANGED_EVENT: &str = "fs-watch-changed";
/// Editors and git write several files per save; report them as one change.
const COALESCE: Duration = Duration::from_millis(150);

#[derive(Default)]
pub struct FsWatch(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    watcher: Option<RecommendedWatcher>,
    /// window label → consumer key → requested targets.
    owners: HashMap<String, HashMap<String, Vec<Target>>>,
    /// Watched directory (as registered with the OS) → what it reports as.
    watched: HashMap<PathBuf, Arc<Target>>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum Target {
    /// A listed folder; reported back as the path string the UI sent.
    Dir(String),
    /// Git metadata for the repository containing this path.
    Git(String),
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Changed {
    /// Folders whose entries were added, removed or renamed.
    entries: Vec<String>,
    /// Folders where an existing file's contents changed.
    contents: Vec<String>,
    /// Project paths whose git HEAD, index or branches moved.
    git: Vec<String>,
}

/// Replace the folders and git projects one consumer of a window watches.
#[tauri::command(async)]
pub fn fs_watch_set(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FsWatch>,
    key: String,
    dirs: Vec<String>,
    git: Vec<String>,
) -> Result<(), String> {
    let targets: Vec<Target> = dirs
        .into_iter()
        .map(Target::Dir)
        .chain(git.into_iter().map(Target::Git))
        .collect();
    let mut inner = state.0.lock().map_err(|_| "File watcher is locked")?;
    let owner = inner.owners.entry(window.label().to_string()).or_default();
    if targets.is_empty() {
        owner.remove(&key);
    } else {
        owner.insert(key, targets);
    }
    inner.sync(&app);
    Ok(())
}

/// Drop everything a closed window asked to watch.
pub fn window_closed(app: &AppHandle, label: &str) {
    let state = tauri::Manager::state::<FsWatch>(app);
    let Ok(mut inner) = state.0.lock() else {
        return;
    };
    if inner.owners.remove(label).is_some() {
        inner.sync(app);
    }
}

impl Inner {
    fn sync(&mut self, app: &AppHandle) {
        let mut desired: HashMap<PathBuf, Arc<Target>> = HashMap::new();
        for target in self
            .owners
            .values()
            .flat_map(|keys| keys.values())
            .flatten()
        {
            let target = Arc::new(target.clone());
            for dir in watch_dirs(&target) {
                // FSEvents reports resolved paths (/private/var for /var).
                let dir = dir.canonicalize().unwrap_or(dir);
                desired.entry(dir).or_insert_with(|| target.clone());
            }
        }
        if desired.is_empty() && self.watcher.is_none() {
            return;
        }
        if self.watcher.is_none() {
            match spawn_watcher(app.clone()) {
                Some(watcher) => self.watcher = Some(watcher),
                None => return,
            }
        }
        let watcher = self.watcher.as_mut().expect("watcher");
        self.watched.retain(|dir, _| {
            let keep = desired.contains_key(dir);
            if !keep {
                let _ = watcher.unwatch(dir);
            }
            keep
        });
        for (dir, target) in desired {
            match self.watched.entry(dir) {
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    entry.insert(target);
                }
                // A folder can vanish between listing and watching; skip it.
                std::collections::hash_map::Entry::Vacant(entry) => {
                    if watcher
                        .watch(entry.key(), RecursiveMode::NonRecursive)
                        .is_ok()
                    {
                        entry.insert(target);
                    }
                }
            }
        }
    }
}

fn watch_dirs(target: &Target) -> Vec<PathBuf> {
    match target {
        Target::Dir(dir) => {
            let path = expand_home(dir);
            if path.is_dir() {
                vec![path]
            } else {
                Vec::new()
            }
        }
        Target::Git(project) => git_watch_dirs(&expand_home(project)),
    }
}

/// HEAD and index live in the (worktree) git dir; branch tips in refs/heads.
fn git_watch_dirs(project: &Path) -> Vec<PathBuf> {
    let Some(git_dir) = find_git_dir(project) else {
        return Vec::new();
    };
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|raw| git_dir.join(raw.trim()))
        .unwrap_or_else(|| git_dir.clone());
    let mut dirs = vec![git_dir.clone()];
    for dir in [common.join("refs").join("heads"), common] {
        if dir.is_dir() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

fn find_git_dir(start: &Path) -> Option<PathBuf> {
    for dir in start.ancestors() {
        let dot_git = dir.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        if dot_git.is_file() {
            let raw = std::fs::read_to_string(&dot_git).ok()?;
            let target = raw.trim().strip_prefix("gitdir:")?.trim();
            let path = Path::new(target);
            return Some(if path.is_absolute() {
                path.to_path_buf()
            } else {
                dir.join(path)
            });
        }
    }
    None
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(path.trim_start_matches('~').trim_start_matches('/'));
        }
    }
    PathBuf::from(path)
}

fn spawn_watcher(app: AppHandle) -> Option<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<notify::Event>();
    let watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            let _ = tx.send(event);
        }
    })
    .ok()?;
    std::thread::Builder::new()
        .name("fs-watch".into())
        .spawn(move || emit_loop(app, rx))
        .ok()?;
    Some(watcher)
}

fn emit_loop(app: AppHandle, rx: mpsc::Receiver<notify::Event>) {
    while let Ok(first) = rx.recv() {
        let mut events = vec![first];
        while let Ok(event) = rx.recv_timeout(COALESCE) {
            events.push(event);
        }
        let changed = {
            let state = tauri::Manager::state::<FsWatch>(&app);
            let Ok(inner) = state.0.lock() else {
                return;
            };
            classify(&inner.watched, &events)
        };
        if !changed.entries.is_empty() || !changed.contents.is_empty() || !changed.git.is_empty() {
            let _ = app.emit(CHANGED_EVENT, changed);
        }
    }
}

fn classify(watched: &HashMap<PathBuf, Arc<Target>>, events: &[notify::Event]) -> Changed {
    let mut entries = HashSet::new();
    let mut contents = HashSet::new();
    let mut git = HashSet::new();
    for event in events {
        let structural = match event.kind {
            EventKind::Access(_) => continue,
            EventKind::Create(_) | EventKind::Remove(_) => true,
            EventKind::Modify(ModifyKind::Name(_)) => true,
            EventKind::Modify(ModifyKind::Metadata(_)) => false,
            EventKind::Modify(_) => false,
            EventKind::Any | EventKind::Other => true,
        };
        for path in &event.paths {
            let Some(parent) = path.parent() else {
                continue;
            };
            // Overflow and FSEvents rescans name the watched folder itself.
            let target = watched.get(parent).or_else(|| watched.get(path.as_path()));
            let Some(target) = target else {
                continue;
            };
            match target.as_ref() {
                Target::Dir(dir) => {
                    if structural {
                        entries.insert(dir.clone());
                    } else {
                        contents.insert(dir.clone());
                    }
                }
                Target::Git(project) => {
                    if is_git_state_file(path) {
                        git.insert(project.clone());
                    }
                }
            }
        }
    }
    Changed {
        entries: entries.into_iter().collect(),
        contents: contents.into_iter().collect(),
        git: git.into_iter().collect(),
    }
}

/// Lock files and object writes churn without changing what git reports.
fn is_git_state_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !name.ends_with(".lock")
        && !matches!(name, "objects" | "logs" | "FETCH_HEAD" | "COMMIT_EDITMSG")
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn event(kind: EventKind, path: &str) -> notify::Event {
        notify::Event::new(kind).add_path(PathBuf::from(path))
    }

    fn watched() -> HashMap<PathBuf, Arc<Target>> {
        HashMap::from([
            (
                PathBuf::from("/p/src"),
                Arc::new(Target::Dir("/p/src".into())),
            ),
            (PathBuf::from("/p/.git"), Arc::new(Target::Git("/p".into()))),
        ])
    }

    #[test]
    fn classifies_listing_content_and_git_changes() {
        let changed = classify(
            &watched(),
            &[
                event(EventKind::Create(CreateKind::File), "/p/src/new.ts"),
                event(
                    EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                    "/p/src/a.ts",
                ),
                event(EventKind::Create(CreateKind::File), "/p/.git/index.lock"),
                event(EventKind::Remove(RemoveKind::File), "/p/.git/index.lock"),
                event(EventKind::Modify(ModifyKind::Any), "/p/.git/index"),
                event(EventKind::Create(CreateKind::File), "/elsewhere/x"),
            ],
        );
        assert_eq!(changed.entries, vec!["/p/src".to_string()]);
        assert_eq!(changed.contents, vec!["/p/src".to_string()]);
        assert_eq!(changed.git, vec!["/p".to_string()]);
    }

    #[test]
    fn lock_churn_alone_reports_nothing() {
        let changed = classify(
            &watched(),
            &[event(
                EventKind::Create(CreateKind::File),
                "/p/.git/index.lock",
            )],
        );
        assert!(changed.git.is_empty());
    }

    #[test]
    fn real_watcher_reports_a_created_file_in_a_listed_folder() {
        let root = std::env::temp_dir().join(format!("fs-watch-live-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let (tx, rx) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    let _ = tx.send(event);
                }
            })
            .unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();
        std::fs::write(root.join("new.txt"), "x").unwrap();
        let mut events = Vec::new();
        while let Ok(event) = rx.recv_timeout(Duration::from_secs(2)) {
            events.push(event);
            if !classify(&live_watched(&root), &events).entries.is_empty() {
                break;
            }
        }
        let changed = classify(&live_watched(&root), &events);
        assert_eq!(changed.entries, vec!["/listed".to_string()]);
        let _ = std::fs::remove_dir_all(root);
    }

    fn live_watched(root: &Path) -> HashMap<PathBuf, Arc<Target>> {
        HashMap::from([(root.to_path_buf(), Arc::new(Target::Dir("/listed".into())))])
    }

    #[test]
    fn finds_linked_worktree_git_dir() {
        let root = std::env::temp_dir().join(format!("fs-watch-{}", std::process::id()));
        let worktree = root.join("wt");
        let git_dir = root.join("main.git").join("worktrees").join("wt");
        std::fs::create_dir_all(worktree.join("sub")).unwrap();
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", git_dir.display()),
        )
        .unwrap();
        assert_eq!(find_git_dir(&worktree.join("sub")), Some(git_dir));
        let _ = std::fs::remove_dir_all(root);
    }
}
