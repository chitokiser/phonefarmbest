# Provenance

`ADBKeyboard.apk` in this directory is vendored, unmodified, from the
[senzhk/ADBKeyBoard](https://github.com/senzhk/ADBKeyBoard) project
(`ADBKeyboard.apk` at the repository's `master` HEAD at the time of
vendoring).

It's an Android IME that receives Unicode text via the `ADB_INPUT_TEXT`
broadcast intent (`am broadcast -a ADB_INPUT_TEXT --es msg "..."`) and
commits it directly through `InputConnection`, bypassing KeyEvent
synthesis entirely. This is necessary because both scrcpy's
`TYPE_INJECT_TEXT` control message and Android's own
`adb shell input text` go through KeyEvent-based text injection, which
cannot represent CJK text (confirmed on a real device: `input text`
with Korean text throws a `NullPointerException` inside
`Input$InputText.sendText`).

Licensed under the GNU General Public License v2.0 — see `LICENSE` in
this directory. It's installed onto a managed device and invoked as an
independent process via ADB (`src/main/streaming/deviceControl.ts`),
not linked into MPCC's own code.
