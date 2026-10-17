/**
 * One AudioContext shared by every speaking indicator. Browsers cap how many
 * contexts a page may create, and a full room would otherwise want one per
 * participant. Contexts start suspended until the user interacts with the page,
 * so we resume on the first click/keypress.
 */
let ctx: AudioContext | null = null;

export function sharedAudioContext(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const created = new Ctor();
  ctx = created;
  const resume = () => {
    if (created.state === "suspended") void created.resume();
  };
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  resume();
  return created;
}
