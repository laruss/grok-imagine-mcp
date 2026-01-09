import { createRoot } from "react-dom/client";

const container = document.getElementById("root");

if (container) {
	const root = createRoot(container);
	root.render(<div className="p-6">there is no options page yet</div>);
}
