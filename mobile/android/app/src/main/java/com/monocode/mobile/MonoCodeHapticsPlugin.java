package com.monocode.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Cancellable, device-tuned ticks. System touch-feedback preferences always win. */
@CapacitorPlugin(name = "MonoCodeHaptics")
public class MonoCodeHapticsPlugin extends Plugin {
    private boolean foreground = true;

    private Vibrator motor() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager manager = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
    }
    private void resolve(PluginCall call, String status) {
        JSObject result = new JSObject();
        result.put("status", status);
        call.resolve(result);
    }
    private void stop() {
        Vibrator vibrator = motor();
        if (vibrator != null) vibrator.cancel();
    }
    @Override protected void handleOnPause() {
        foreground = false;
        stop();
    }
    @Override protected void handleOnResume() { foreground = true; }

    @PluginMethod public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { stop(); call.resolve(); }
            catch (Exception error) { call.reject("Unable to cancel haptics", error); }
        });
    }

    private interface Feedback { void play(Vibrator vibrator); }

    private void play(PluginCall call, Feedback feedback) {
        getActivity().runOnUiThread(() -> {
            try {
                if (!foreground || !getActivity().hasWindowFocus()) {
                    resolve(call, "inactive");
                    return;
                }
                if (Settings.System.getInt(getContext().getContentResolver(),
                    Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 0) {
                    resolve(call, "system-disabled");
                    return;
                }
                Vibrator vibrator = motor();
                if (vibrator == null || !vibrator.hasVibrator()) {
                    resolve(call, "unavailable");
                    return;
                }
                feedback.play(vibrator);
                // This acknowledges the request, not a measured physical vibration.
                resolve(call, "requested");
            } catch (Exception error) { call.reject("Unable to play haptics", error); }
        });
    }

    @SuppressWarnings("deprecation")
    private void tick(Vibrator vibrator, boolean standard) {
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).build();
        if (Build.VERSION.SDK_INT >= 29) {
            // Very short, low-amplitude one-shots can be imperceptible on OEM motors.
            // Let the device supply its tuned effect, with the platform fallback.
            int effect = standard ? VibrationEffect.EFFECT_CLICK : VibrationEffect.EFFECT_TICK;
            if (Build.VERSION.SDK_INT >= 30 && vibrator.areEffectsSupported(effect)[0] == Vibrator.VIBRATION_EFFECT_SUPPORT_NO)
                effect = VibrationEffect.EFFECT_CLICK;
            vibrator.vibrate(VibrationEffect.createPredefined(effect), attributes);
        } else if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createOneShot(standard ? 35 : 25,
                VibrationEffect.DEFAULT_AMPLITUDE), attributes);
        } else vibrator.vibrate(standard ? 35 : 25, attributes);
    }

    @PluginMethod public void pulse(PluginCall call) {
        play(call, vibrator -> tick(vibrator, "standard".equals(call.getString("strength"))));
    }
    @PluginMethod public void feedback(PluginCall call) {
        play(call, vibrator -> {
            stop();
            String cue = call.getString("cue", "light");
            View view = getBridge().getWebView();
            int effect = "attention".equals(cue) ? HapticFeedbackConstants.LONG_PRESS
                : "success".equals(cue) && Build.VERSION.SDK_INT >= 30
                    ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
            if (!view.performHapticFeedback(effect)) tick(vibrator, true);
        });
    }
}
