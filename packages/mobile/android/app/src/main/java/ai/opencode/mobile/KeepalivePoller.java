package ai.opencode.mobile;

import android.util.Log;

import org.json.JSONObject;

import java.util.HashSet;

final class KeepalivePoller implements Runnable {
  private static final String TAG = "KeepalivePoller";
  private static final long TRACK_GRACE_MS = 15_000;

  private final KeepaliveService svc;
  private final KeepaliveClient client;
  private final KeepaliveNotifier note;

  KeepalivePoller(KeepaliveService svc, KeepaliveClient client, KeepaliveNotifier note) {
    this.svc = svc;
    this.client = client;
    this.note = note;
  }

  @Override
  public void run() {
    poll();
  }

  void poll() {
    if (KeepaliveState.url() == null || KeepaliveState.url().isEmpty()) return;
    if (KeepaliveState.tracked().isEmpty()) return;

    try {
      JSONObject status = client.status();
      for (String sessionID : new HashSet<>(KeepaliveState.tracked())) {
        JSONObject item = status.optJSONObject(sessionID);
        if (item != null) {
          if (!"idle".equals(item.optString("type"))) {
            KeepaliveState.seen().add(sessionID);
            KeepaliveState.done().remove(sessionID);
            continue;
          }
          if (!client.done(sessionID)) {
            KeepaliveState.done().remove(sessionID);
            continue;
          }
          if (!KeepaliveState.done().add(sessionID)) {
            finish(sessionID);
          }
          continue;
        }

        if (!KeepaliveState.seen().contains(sessionID)) {
          long at = KeepaliveState.start().getOrDefault(sessionID, 0L);
          if (System.currentTimeMillis() - at < TRACK_GRACE_MS) continue;
        }

        if (!client.done(sessionID)) {
          KeepaliveState.done().remove(sessionID);
          continue;
        }
        if (!KeepaliveState.done().add(sessionID)) {
          finish(sessionID);
        }
      }
    } catch (Exception err) {
      Log.d(TAG, "poll failed", err);
    }
  }

  private void finish(String sessionID) {
    Log.d(TAG, "finish sessionID=" + sessionID);
    String href = KeepaliveState.href(sessionID);
    KeepaliveState.untrack(sessionID);
    if (!KeepaliveState.notifyOn()) return;
    if (KeepaliveState.active() || svc.foreground()) return;
    String body = client.reply(sessionID);
    if (body == null || body.isEmpty()) body = "任务已完成";
    note.done(sessionID, href, body);
  }
}
