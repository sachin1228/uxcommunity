/** Inject before navigation so the mark also catches a fast cached render. */
export function observeCommunityChatReady(communityId) {
  let pending = false;
  const ready = () => {
    const timeline = document.querySelector('[role="log"][data-chat-ready="true"]');
    const composer = document.querySelector('[data-chat-input]');
    const visible = (element) => element && element.getBoundingClientRect().height > 0
      && getComputedStyle(element).visibility === "visible" && getComputedStyle(element).display !== "none";
    return timeline?.getAttribute('data-community-id') === communityId
      && visible(timeline) && visible(composer) && !composer.disabled;
  };
  const observer = new MutationObserver(check);
  function check() {
    if (pending || !ready()) return;
    pending = true;
    // Cross a paint boundary, then recheck in case navigation or layout hid it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pending = false;
      if (!ready()) return;
      performance.mark("community-chat-ready");
      observer.disconnect();
    }));
  }
  observer.observe(document, { childList: true, subtree: true, attributes: true });
  check();
}
