// Initiate appVersion on window object
(window as any).appVersion = "";

// Function to check for a new version
async function checkForUpdate() {
  try {
    const response = await fetch("/api/version");
    const newVersion = await response.text();

    if (newVersion !== (window as any).appVersion) {
      console.log("New version detected. Reloading page...");
      window.location.reload();
    }
  } catch (error) {
    console.error("Failed to check for new version:", error);
  }
}

// Store the initial version on page load
fetch("/api/version")
  .then((response) => response.text())
  .then((version) => {
    (window as any).appVersion = version;
    setInterval(checkForUpdate, 300000);
  });