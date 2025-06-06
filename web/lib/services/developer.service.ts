import { httpClient, HttpError } from "@/lib/http-client";

export class DeveloperServiceError extends Error {
    constructor(
        message: string,
        public status: number = 500,
        public code?: string
    ) {
        super(message);
        this.name = 'DeveloperServiceError';
    }
}

class DeveloperService {
    async downloadGasTemplate(): Promise<Blob> {
        try {
            console.log('🔽 Downloading GAS template from: /applications/config/gas');

            // 正しいパス: /applications/config/gas (複数形)
            // Lambda関数は 'text/plain' を返すので Accept ヘッダーを修正
            const response = await httpClient.get<Blob>('/applications/config/gas', {
                headers: {
                    'Accept': 'text/plain', // Lambda関数のContent-Typeに合わせる
                },
                responseType: 'blob', // Blob として受信
            });

            console.log('✅ GAS template downloaded successfully:', {
                type: response.type,
                size: response.size
            });

            return response;

        } catch (error) {
            console.error('GAS template download error:', error);

            if (error instanceof HttpError) {
                throw new DeveloperServiceError(
                    `Failed to download GAS template: ${error.message}`,
                    error.status
                );
            }
            throw new DeveloperServiceError('Failed to download GAS template');
        }
    }
}

export const developerService = new DeveloperService();