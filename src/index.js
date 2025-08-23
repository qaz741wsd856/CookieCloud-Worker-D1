// src/index.js
import { Router } from 'itty-router';
import CryptoJS from 'crypto-js';

/**
 * 辅助函数：安全地获取请求体（支持 Gzip 解压）
 * @param {Request} request 
 * @returns {Promise<object>}
 */
async function getRequestBody(request) {
    // 如果请求没有 body (例如 GET 请求)，返回空对象
    if (!request.body) {
        return {};
    }

    try {
        // 检查请求头，看客户端是否发送了 Gzip 压缩的数据
        if (request.headers.get('content-encoding') === 'gzip') {
            // 将请求体（ReadableStream）通过 DecompressionStream 进行解压
            const decompressedStream = request.body.pipeThrough(new DecompressionStream('gzip'));
            // 从解压后的流创建一个新的 Response 对象，以便使用 .json() 方法
            const tempResponse = new Response(decompressedStream);
            return await tempResponse.json();
        } else {
            // 如果没有压缩，直接解析 JSON
            return await request.json();
        }
    } catch (e) {
        // 如果解析失败 (例如 body 为空或格式错误)，返回空对象
        console.error("Failed to parse request body:", e);
        return {};
    }
}


// 解密函数 (与你的原始代码相同)
function cookie_decrypt(uuid, encrypted, password) {
    const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
    const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
    const parsed = JSON.parse(decrypted);
    return parsed;
}

// 导出 Worker 的 fetch handler，将 env 传入以获取环境变量
export default {
    async fetch(request, env, ctx) {
        // ====================================================================
        // 高级功能 1: 自定义路径
        // 从环境变量中读取 API_ROOT，并进行标准化处理 (确保前面有 / 且后面没有 /)
        const apiRoot = env.API_ROOT ? `/${env.API_ROOT.replace(/^\/|\/$/g, '')}` : '';
        // ====================================================================

        // 创建一个新的 router 实例，每次请求都基于最新的 apiRoot
        const router = Router();

        // 健康检查
        router.get(`${apiRoot}/health`, () => {
            return new Response(JSON.stringify({
                status: 'OK',
                timestamp: new Date().toISOString()
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        });

        // 根路径
        router.get(`${apiRoot}/`, () => {
            return new Response(`Hello World from Cloudflare Worker! API Root is configured to: '${apiRoot}'`);
        });

        // 更新或创建数据
        router.post(`${apiRoot}/update`, async (request) => {
            try {
                // 使用新的辅助函数获取请求体
                const { encrypted, uuid } = await getRequestBody(request);

                if (!encrypted || !uuid) {
                    return new Response('Bad Request: Missing required fields', { status: 400 });
                }

                const stmt = env.DB.prepare('INSERT INTO cookies (uuid, encrypted_data) VALUES (?, ?) ON CONFLICT(uuid) DO UPDATE SET encrypted_data = excluded.encrypted_data');
                await stmt.bind(uuid, encrypted).run();
                
                console.log(`Data updated for UUID: ${uuid}`);
                return new Response(JSON.stringify({ action: "done" }), { headers: { 'Content-Type': 'application/json' } });

            } catch (error) {
                console.error('Update error:', error);
                return new Response('Internal Server Error', { status: 500 });
            }
        });

        // 获取数据
        router.all(`${apiRoot}/get/:uuid`, async (request) => {
            try {
                const { uuid } = request.params;
                if (!uuid) {
                    return new Response('Bad Request: Missing UUID', { status: 400 });
                }

                const stmt = env.DB.prepare('SELECT encrypted_data FROM cookies WHERE uuid = ?');
                const result = await stmt.bind(uuid).first();

                if (!result) {
                    return new Response('Not Found', { status: 404 });
                }

                const encryptedData = result.encrypted_data;
                // 使用新的辅助函数获取请求体
                const body = await getRequestBody(request);

                if (body && body.password) {
                    const decrypted = cookie_decrypt(uuid, encryptedData, body.password);
                    return new Response(JSON.stringify(decrypted), { headers: { 'Content-Type': 'application/json' } });
                } else {
                    return new Response(JSON.stringify({ encrypted: encryptedData }), { headers: { 'Content-Type': 'application/json' } });
                }

            } catch (error) {
                console.error('Get error:', error);
                return new Response('Internal Server Error', { status: 500 });
            }
        });

        // 404 Handler
        router.all('*', () => new Response('404, not found!', { status: 404 }));

        // ---- CORS & Final Response Logic ----
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
            'Access-Control-Max-Age': '86400',
            'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Content-Encoding' // 添加 Content-Encoding
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        
        const response = await router.handle(request);

        Object.entries(corsHeaders).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    }
};