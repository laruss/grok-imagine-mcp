export type ContentScriptResponseType = {
	success: boolean;
	imageUrls?: string[];
	error?: string;
};

export type SendResponseCallback = (
	response: ContentScriptResponseType,
) => void;
