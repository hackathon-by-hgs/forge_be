-- §24 push pipeline — split the granular FCM channel kind off from the
-- coarse in-app feed kind. The mobile spec (19_notifications.md) declares
-- `Notification.kind` as one of `new_job | application_update | payment |
-- loan | system`, but the FCM channel/sound mapping needs the granular kind
-- (`payment_received` vs `payment_held_for_review`, etc.). Storing both lets
-- the in-app feed surface the spec-compliant coarse value while the push
-- dispatcher still picks the right Android channel + custom sound.
--
-- Nullable + no backfill: legacy rows fall back to mapping by `kind` in
-- PushNotificationService.

ALTER TABLE "notifications"
  ADD COLUMN "push_kind" TEXT;
