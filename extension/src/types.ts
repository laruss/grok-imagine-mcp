export type ContentScriptResponseType = {
    success: boolean;
    imageUrl?: string;
    error?: string;
};

export type SendResponseCallback = (response: ContentScriptResponseType) => void;
