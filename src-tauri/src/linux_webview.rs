use std::ffi::CStr;
use std::sync::OnceLock;

use glib::object::ObjectType;
use libc::{c_char, c_int, c_void};

type Pointer = *mut c_void;

/// Keep live layout changes on the main scrolling path. On WebKitGTK 2.52,
/// threaded scrolling adds substantial latency while a terminal pane resizes.
pub fn configure(webview: &tauri::Webview) {
    let _ = webview.with_webview(|platform| {
        static API: OnceLock<Option<FeatureApi>> = OnceLock::new();
        // These public APIs arrived in WebKitGTK 2.42. Resolve them at runtime
        // so older WebKit installations retain their existing behavior.
        let Some(api) = API.get_or_init(|| unsafe { FeatureApi::load() }) else {
            return;
        };
        let view = platform.inner();
        // with_webview runs on GTK's main thread and keeps the view alive.
        unsafe { api.disable_threaded_scrolling(view.as_ptr().cast()) };
    });
}

struct FeatureApi {
    settings: unsafe extern "C" fn(Pointer) -> Pointer,
    features: unsafe extern "C" fn() -> Pointer,
    length: unsafe extern "C" fn(Pointer) -> usize,
    get: unsafe extern "C" fn(Pointer, usize) -> Pointer,
    identifier: unsafe extern "C" fn(Pointer) -> *const c_char,
    set_enabled: unsafe extern "C" fn(Pointer, Pointer, c_int),
    unref: unsafe extern "C" fn(Pointer),
}

impl FeatureApi {
    unsafe fn load() -> Option<Self> {
        macro_rules! symbol {
            ($name:literal, $signature:ty) => {{
                let address = libc::dlsym(libc::RTLD_DEFAULT, concat!($name, "\0").as_ptr().cast());
                if address.is_null() {
                    return None;
                }
                // Signatures match WebKitSettings.h and WebKitFeature.h.
                // WebKit is linked by Wry and remains loaded for the app's life.
                std::mem::transmute::<Pointer, $signature>(address)
            }};
        }
        Some(Self {
            settings: symbol!(
                "webkit_web_view_get_settings",
                unsafe extern "C" fn(Pointer) -> Pointer
            ),
            features: symbol!(
                "webkit_settings_get_all_features",
                unsafe extern "C" fn() -> Pointer
            ),
            length: symbol!(
                "webkit_feature_list_get_length",
                unsafe extern "C" fn(Pointer) -> usize
            ),
            get: symbol!(
                "webkit_feature_list_get",
                unsafe extern "C" fn(Pointer, usize) -> Pointer
            ),
            identifier: symbol!(
                "webkit_feature_get_identifier",
                unsafe extern "C" fn(Pointer) -> *const c_char
            ),
            set_enabled: symbol!(
                "webkit_settings_set_feature_enabled",
                unsafe extern "C" fn(Pointer, Pointer, c_int)
            ),
            unref: symbol!("webkit_feature_list_unref", unsafe extern "C" fn(Pointer)),
        })
    }

    unsafe fn disable_threaded_scrolling(&self, view: Pointer) {
        let settings = (self.settings)(view);
        if settings.is_null() {
            return;
        }
        let features = (self.features)();
        if features.is_null() {
            return;
        }
        for index in 0..(self.length)(features) {
            let feature = (self.get)(features, index);
            if feature.is_null() {
                continue;
            }
            let identifier = (self.identifier)(feature);
            if !identifier.is_null()
                && CStr::from_ptr(identifier).to_bytes() == b"ThreadedScrolling"
            {
                (self.set_enabled)(settings, feature, 0);
                break;
            }
        }
        (self.unref)(features);
    }
}
