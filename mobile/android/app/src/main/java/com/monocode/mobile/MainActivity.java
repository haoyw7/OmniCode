package com.monocode.mobile;

import android.os.Bundle;
import android.view.View;
import android.view.animation.Interpolator;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.List;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private String safeAreaScript;
    private String keyboardScript;
    private boolean imeAnimating;
    private int keyboardBottom;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MonoCodeCredentialsPlugin.class);
        registerPlugin(MonoCodeHapticsPlugin.class);
        registerPlugin(MonoCodeUpdatesPlugin.class);
        registerPlugin(MonoCodeNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        installEdgeToEdgeInsets();
    }

    private void installEdgeToEdgeInsets() {
        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, insets) -> {
            Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            keyboardBottom = keyboardVisible ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
            // Keep the WebView full screen, including while the IME is open.
            // Resizing it invalidates viewport styles throughout the message
            // history and stalls dismissal before its first animation frame.
            // The page reserves keyboard space inside its own layout instead.
            float density = getResources().getDisplayMetrics().density;
            safeAreaScript = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--safe-area-inset-top', '%.2fpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-right', '%.2fpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-bottom', '%.2fpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-left', '%.2fpx');",
                safe.top / density,
                safe.right / density,
                safe.bottom / density,
                safe.left / density
            );
            // Keep physical safe areas stable. Keyboard-following surfaces
            // remove the bottom inset locally, without restyling the history.
            if (!imeAnimating) {
                sendKeyboard(view, 0, null);
            }
            // Consume bars explicitly so Chromium cannot add a second inset.
            // The keyboard too: a WebView that sees it pans the page to reveal
            // the focused field while the page already lifts its controls,
            // throwing the composer toward the top until the resize lands.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime(),
                    Insets.NONE
                )
                .build();
        });
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (safeAreaScript != null) view.evaluateJavascript(safeAreaScript, null);
                if (keyboardScript != null) view.evaluateJavascript(keyboardScript, null);
                ViewCompat.requestApplyInsets(decor);
            }
        });
        // Replaces the Keyboard plugin's callback on the same view; the web
        // layer reads these keyboard events instead of the plugin's. The
        // animation stops here so the WebView never follows the keyboard on
        // its own as well.
        ViewCompat.setWindowInsetsAnimationCallback(
            decor,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_STOP) {
                @Override
                public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                    if (isIme(animation)) imeAnimating = true;
                }

                @NonNull
                @Override
                public WindowInsetsAnimationCompat.BoundsCompat onStart(
                    @NonNull WindowInsetsAnimationCompat animation,
                    @NonNull WindowInsetsAnimationCompat.BoundsCompat bounds
                ) {
                    // Insets were already applied with the end state.
                    if (isIme(animation)) sendKeyboard(decor, animation.getDurationMillis(), animation.getInterpolator());
                    return bounds;
                }

                @NonNull
                @Override
                public WindowInsetsCompat onProgress(
                    @NonNull WindowInsetsCompat insets,
                    @NonNull List<WindowInsetsAnimationCompat> runningAnimations
                ) {
                    return insets;
                }

                @Override
                public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                    if (!isIme(animation)) return;
                    imeAnimating = false;
                }
            }
        );
        ViewCompat.requestApplyInsets(decor);
    }

    private static boolean isIme(WindowInsetsAnimationCompat animation) {
        return (animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0;
    }

    /** Tells the page where the keyboard is heading and how it moves. */
    private void sendKeyboard(View decor, long duration, Interpolator interpolator) {
        float density = getResources().getDisplayMetrics().density;
        String format =
            "window.dispatchEvent(new CustomEvent('monocode:keyboard',{detail:{height:%.2f,viewport:%.2f,duration:%d,easing:'%s'}}));";
        float height = keyboardBottom / density;
        float viewport = decor.getHeight() / density;
        // A reloaded page only needs the settled position.
        keyboardScript = String.format(Locale.US, format, height, viewport, 0, "linear");
        bridge.getWebView().evaluateJavascript(
            // Measure the old transcript before changing safe-area styles.
            // Both writes then reach layout together instead of forcing two
            // full-history style passes at the start of each keyboard motion.
            String.format(Locale.US, format, height, viewport, Math.max(0, duration), easing(interpolator)) + safeAreaScript,
            null
        );
    }

    /** Samples the keyboard's interpolator as a CSS linear() easing. */
    private static String easing(Interpolator interpolator) {
        if (interpolator == null) return "linear";
        StringBuilder css = new StringBuilder("linear(");
        int steps = 32;
        for (int i = 0; i <= steps; i++) {
            if (i > 0) css.append(',');
            css.append(String.format(Locale.US, "%.4f", interpolator.getInterpolation(i / (float) steps)));
        }
        return css.append(')').toString();
    }
}
