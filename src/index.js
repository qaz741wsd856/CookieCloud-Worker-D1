// src/index.js
import { Router } from 'itty-router';
// 缓存 Router 实例以复用并支持动态 API_ROOT
const routerCache = new Map();
function getRouter(apiRoot, env) {
    if (!routerCache.has(apiRoot)) {
        const router = Router();
        // 健康检查
        router.get(`${apiRoot}/health`, () => new Response(JSON.stringify({ status: 'OK', timestamp: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } }));
        // 根路径
        router.get(`${apiRoot}/`, () => new Response(`Hello World from Cloudflare Worker! `));
        // 更新或创建数据
        router.post(`${apiRoot}/update`, async request => {
            const { encrypted, uuid } = await getRequestBody(request);
            if (!encrypted || !uuid) return new Response('Bad Request: Missing required fields', { status: 400 });
            await saveInChunks(env, uuid, encrypted);
            console.log('Data updated for UUID:', uuid);
            return new Response(JSON.stringify({ action: 'done' }), { headers: { 'Content-Type': 'application/json' } });
        });
        // 获取数据
        router.all(`${apiRoot}/get/:uuid`, async (request) => {
            try {
                const { uuid } = request.params;
                if (!uuid) {
                    return new Response('Bad Request: Missing UUID', { status: 400 });
                }

                // 1. 先一次性查询出所有分块数据
                const { results } = await env.DB.prepare(
                    'SELECT chunk FROM cookies_chunks WHERE uuid = ? ORDER BY seq'
                ).bind(uuid).all();
                
                if (!results || results.length === 0) {
                    return new Response('Not Found', { status: 404 });
                }

                // 2. 检查是否需要解密（罕见情况，不进行内存优化）
                const body = await getRequestBody(request);
                if (body && body.password) {
                    // 拼接字符串，因为解密库需要完整的数据
                    const encryptedData = results.map(r => r.chunk).join('');
                    const decrypted = cookie_decrypt(uuid, encryptedData, body.password);
                    return new Response(JSON.stringify(decrypted), { headers: { 'Content-Type': 'application/json' } });
                }

                // 3. 使用 ReadableStream 流式响应，避免内存拼接
                const readableStream = new ReadableStream({
                    start(controller) {
                        // 使用 TextEncoder 将字符串编码为 Uint8Array（Cloudflare Worker 需要字节流）
                        const encoder = new TextEncoder();
                        // 发送 JSON 开头部分
                        controller.enqueue(encoder.encode('{"encrypted":"'));
                        // 逐块发送数据（数据库中的 chunk 是字符串）
                        for (const row of results) {
                            controller.enqueue(encoder.encode(row.chunk));
                        }
                        // 发送 JSON 结尾部分
                        controller.enqueue(encoder.encode('"}'));
                        // 关闭流
                        controller.close();
                    }
                });

                // 返回流式响应
                return new Response(readableStream, {
                    headers: { 'Content-Type': 'application/json' }
                });

            } catch (error) {
                console.error('Get error:', error);
                return new Response('Internal Server Error', { status: 500 });
            }
        });
        // 404 Handler
        router.all('*', () => new Response('404, not found!', { status: 404 }));
        routerCache.set(apiRoot, router);
    }
    return routerCache.get(apiRoot);
}
import CryptoJS from 'crypto-js';

/**
 * 辅助函数：安全地获取请求体（支持 Gzip 解压）
 * @param {Request} request 
 * @returns {Promise<object>}
 */
async function getRequestBody(request) {
    if (!request.body) {
        return {};
    }
    try {
        if (request.headers.get('content-encoding') === 'gzip') {
            const decompressedStream = request.body.pipeThrough(new DecompressionStream('gzip'));
            const tempResponse = new Response(decompressedStream);
            return await tempResponse.json();
        } else {
            return await request.json();
        }
    } catch (e) {
        console.error("Failed to parse request body:", e);
        return {};
    }
}

/**
 * 解密函数
 */
function cookie_decrypt(uuid, encrypted, password) {
    const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
    const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
}

// 默认分块大小：1.9MB
const DEFAULT_CHUNK_SIZE = 1900000;
/**
 * @param {object} env - Worker 环境变量
 * @param {string} uuid - 用户 UUID
 * @param {string} encrypted - 加密的 Cookie 数据
 */
async function saveInChunks(env, uuid, encrypted) {
    // 删除旧记录
    await env.DB.prepare('DELETE FROM cookies_chunks WHERE uuid = ?').bind(uuid).run();
    // 读取环境变量覆盖或使用默认分块大小
    const chunkSize = parseInt(env.CHUNK_SIZE, 10) || DEFAULT_CHUNK_SIZE;
    // 逐个插入分块，避免内存峰值
    const insertStmt = env.DB.prepare('INSERT INTO cookies_chunks (uuid, seq, chunk) VALUES (?, ?, ?)');
    for (let i = 0; i < encrypted.length; i += chunkSize) {
        const chunk = encrypted.slice(i, i + chunkSize);
        await insertStmt.bind(uuid, Math.floor(i / chunkSize), chunk).run();
    }
}

// 导出 Worker 的 fetch handler
export default {
    async fetch(request, env, ctx) {
        // 数据库表初始化，仅执行一次
        if (!ctx.dbInit) {
            ctx.dbInit = env.DB.prepare(
                `CREATE TABLE IF NOT EXISTS cookies_chunks (
                    uuid TEXT,
                    seq INTEGER,
                    chunk TEXT NOT NULL,
                    PRIMARY KEY (uuid, seq)
                );`
            ).run().catch(e => console.error('Error initializing chunks table:', e));
        }
        await ctx.dbInit;
        const apiRoot = env.API_ROOT ? `/${env.API_ROOT.replace(/^\/|\/$/g, '')}` : '';
        const router = getRouter(apiRoot, env);
        // CORS preflight
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
            'Access-Control-Max-Age': '86400',
            'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Content-Encoding'
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        // 交给复用的 router 处理
        const response = await router.handle(request);
        // 挂载 CORS
        Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
        return response;
    }
};