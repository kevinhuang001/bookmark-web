const api = globalThis.browser || chrome;
api.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "selection-ready" && sender.tab)
    api.tabs.create({
      url:
        api.runtime.getURL("capture.html") +
        "?tab=" +
        sender.tab.id +
        "&mode=" +
        (message.mode === "thread" ? "thread" : "selection"),
    });
});
