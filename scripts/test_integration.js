const path = require('path');
const fs = require('fs');

// Mock env và module để có thể chạy offline/cli
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'telegram-auto-post.sqlite3');

const { connectDB } = require('../electron/db');
const extractorService = require('../electron/extractorService');
const pythonService = require('../electron/pythonService');
const telegramService = require('../electron/telegramService');
const TelegramAccount = require('../electron/models/TelegramAccount');

async function run() {
    console.log('=== BẮT ĐẦU TEST TÍCH HỢP TDATA VÀO TELEGRAM AUTO POST ===');
    const archivePath = 'D:\\Telegram\\84852571237 - Copy.7z';
    
    console.log('1. Khởi tạo DB SQLite...');
    await connectDB();
    
    console.log('2. Đang giải nén file Archive...');
    if (!fs.existsSync(archivePath)) {
        console.error('LỖI: File nén không tồn tại tại ' + archivePath);
        process.exit(1);
    }
    
    extractorService.cleanTemp();
    const tdataDir = await extractorService.extractArchive(archivePath);
    console.log('Giải nén thành công. Đường dẫn tdata:', tdataDir);
    
    console.log('3. Đang scan tdata...');
    const scanResult = await pythonService.runAction('scan_tdata', { tdata_dir: tdataDir, passcode: '' });
    console.log('Kết quả scan_tdata:', JSON.stringify(scanResult, null, 2));
    
    if (scanResult.status === 'success' && scanResult.accounts_count > 0) {
        console.log('4. Đang thử convert tài khoản đầu tiên sang session string...');
        const convertResult = await pythonService.runAction('tdata_to_session', {
            tdata_dir: tdataDir,
            passcode: '',
            account_index: 0,
            export_type: 'string'
        });
        
        if (convertResult.status === 'success' && convertResult.session_string) {
            console.log('Convert sang session string thành công! Độ dài:', convertResult.session_string.length);
            
            console.log('5. Đang thử import session vào TelegramService...');
            const apiId = '2040';
            const apiHash = 'b18441a1ff607e10a989891a5462e627';
            const importRes = await telegramService.importSession(apiId, apiHash, convertResult.session_string);
            console.log('Kết quả importSession:', JSON.stringify(importRes, null, 2));
            
            console.log('Đợi 1.5 giây để DB hoàn tất ghi...');
            await new Promise(r => setTimeout(r, 1500));

            console.log('6. Đọc danh sách tài khoản từ SQLite DB...');
            const accounts = await TelegramAccount.find();
            console.log('Danh sách tài khoản hiện có trong DB:', JSON.stringify(accounts, null, 2));
        } else {
            console.error('LỖI: Không convert được sang session string:', convertResult.message);
        }
    } else {
        console.warn('Không có tài khoản nào được tìm thấy hoặc scan thất bại.');
    }
}

run().then(() => {
    console.log('=== HOÀN TẤT TEST TÍCH HỢP ===');
    process.exit(0);
}).catch(err => {
    console.error('Lỗi uncaught trong test tích hợp:', err);
    process.exit(1);
});
