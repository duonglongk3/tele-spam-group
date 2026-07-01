const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class ExtractorService {
    constructor() {
        this.tempDir = path.join(process.cwd(), 'temp_extracted');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.sevenZipPath = 'C:\\Program Files\\7-Zip\\7z.exe';
    }

    cleanTemp() {
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
                fs.mkdirSync(this.tempDir, { recursive: true });
            }
        } catch (e) {
            console.error('Lỗi dọn dẹp thư mục tạm:', e);
        }
    }

    extractArchive(filePath) {
        return new Promise((resolve, reject) => {
            try {
                if (!fs.existsSync(filePath)) {
                    return reject(new Error('File lưu trữ không tồn tại.'));
                }

                const uniqueFolder = `extracted_${Date.now()}`;
                const targetPath = path.join(this.tempDir, uniqueFolder);
                fs.mkdirSync(targetPath, { recursive: true });

                const ext = path.extname(filePath).toLowerCase();

                // Kiểm tra xem có 7z.exe không
                const hasSevenZip = fs.existsSync(this.sevenZipPath);

                if (hasSevenZip) {
                    // Dùng 7-Zip giải nén mọi định dạng
                    const cmd = `& "${this.sevenZipPath}" x "${filePath}" -o"${targetPath}" -y`;
                    exec(cmd, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
                        if (error) {
                            return reject(new Error(`Giải nén bằng 7-Zip thất bại: ${error.message}. Stderr: ${stderr}`));
                        }
                        this._verifyAndResolve(targetPath, resolve, reject);
                    });
                } else {
                    // Nếu không có 7-Zip
                    if (ext === '.zip') {
                        // Sử dụng PowerShell native Expand-Archive
                        const cmd = `Expand-Archive -Path "${filePath}" -DestinationPath "${targetPath}" -Force`;
                        exec(cmd, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
                            if (error) {
                                return reject(new Error(`Giải nén file ZIP bằng PowerShell thất bại: ${error.message}. Stderr: ${stderr}`));
                            }
                            this._verifyAndResolve(targetPath, resolve, reject);
                        });
                    } else {
                        // Đối với 7z và rar, yêu cầu cài 7-zip
                        return reject(new Error(`Định dạng ${ext} không được hỗ trợ giải nén trực tiếp bằng hệ thống mặc định. Vui lòng cài đặt 7-Zip tại 'C:\\Program Files\\7-Zip\\7z.exe' hoặc tự giải nén file và chọn thư mục Tdata.`));
                    }
                }
            } catch (err) {
                reject(new Error(`Lỗi giải nén: ${err.message}`));
            }
        });
    }

    _verifyAndResolve(targetPath, resolve, reject) {
        const tdataDir = this.findTDataDir(targetPath);
        if (tdataDir) {
            resolve(tdataDir);
        } else {
            reject(new Error('Không tìm thấy thư mục TData hợp lệ bên trong file nén (thiếu file key_datas hoặc key).'));
        }
    }

    // Đệ quy tìm thư mục tdata chứa key_datas hoặc key
    findTDataDir(dir) {
        try {
            const files = fs.readdirSync(dir);
            
            if (files.includes('key_datas') || files.includes('key')) {
                return dir;
            }

            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    if (file === 'node_modules' || file === 'temp_extracted') continue;
                    
                    const found = this.findTDataDir(fullPath);
                    if (found) return found;
                }
            }
        } catch (e) {
            console.error('Lỗi khi duyệt thư mục:', e);
        }
        return null;
    }
}

module.exports = new ExtractorService();
