const MAX_LOG_ENTRIES = 50;
export let logEvents = ["[" + new Date().toISOString() + "] Worker started."];

export function addLog(message) {
	const timestamp = new Date().toISOString();
	logEvents.push(`[${timestamp}] ${message}`);
	if (logEvents.length > MAX_LOG_ENTRIES) {
		logEvents.shift(); // Keep the log size manageable
	}
	console.log(message); // Also log to the standard console for `wrangler tail`
}
