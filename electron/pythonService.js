const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class PythonService {
    constructor() {
        this.pythonCmd = null;
        this.scriptPath = path.join(__dirname, 'python', 'converter.py');
        
        // Cấu hình fallback đường dẫn cho Electron packaged app
        if (!fs.existsSync(this.scriptPath)) {
            const possiblePaths = [
                path.join(process.resourcesPath || __dirname, 'electron', 'python', 'converter.py'),
                path.join(process.resourcesPath || __dirname, 'app.asar.unpacked', 'electron', 'python', 'converter.py'),
                path.join(__dirname, '..', 'electron', 'python', 'converter.py')
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    this.scriptPath = p;
                    break;
                }
            }
        }
    }

    // Kiểm tra và lấy lệnh python hợp lệ
    async getPythonCommand() {
        if (this.pythonCmd) return this.pythonCmd;

        const commands = ['python', 'python3', 'py'];
        for (const cmd of commands) {
            try {
                const stdout = execSync(`${cmd} --version`, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000 });
                if (stdout.toString().toLowerCase().includes('python')) {
                    this.pythonCmd = cmd;
                    return cmd;
                }
            } catch (e) {
                // Tiếp tục thử lệnh khác
            }
        }
        throw new Error('Không tìm thấy Python trên hệ thống của bạn. Vui lòng cài đặt Python (v3.8+) và thêm vào PATH.');
    }

    // Kiểm tra và cài đặt dependencies cần thiết
    async checkAndInstallDependencies(logCallback = console.log) {
        const pythonCmd = await this.getPythonCommand();
        logCallback(`Đang kiểm tra môi trường Python (${pythonCmd})...`);

        try {
            const result = await this.runAction('test_passcode', { tdata_dir: '', passcode: '' }, false);
            if (result && result.error_type === 'import_error') {
                logCallback('Thiếu các thư viện Python cần thiết (opentele, telethon). Bắt đầu tự động cài đặt...');
                await this.installDependencies(pythonCmd, logCallback);
            }
        } catch (e) {
            if (e.message && (e.message.includes('opentele') || e.message.includes('ImportError'))) {
                logCallback('Thiếu thư viện opentele/telethon. Bắt đầu tự động cài đặt...');
                await this.installDependencies(pythonCmd, logCallback);
            } else {
                logCallback('Đang kiểm tra/cài đặt thư viện Python...');
                await this.installDependencies(pythonCmd, logCallback);
            }
        }
    }

    installDependencies(pythonCmd, logCallback) {
        return new Promise((resolve, reject) => {
            logCallback('Đang chạy lệnh: pip install opentele telethon cryptography...');
            const pip = spawn(pythonCmd, ['-m', 'pip', 'install', 'opentele', 'telethon', 'cryptography']);

            pip.stdout.on('data', (data) => {
                logCallback(`[pip] ${data.toString().trim()}`);
            });

            pip.stderr.on('data', (data) => {
                logCallback(`[pip-warning] ${data.toString().trim()}`);
            });

            pip.on('close', (code) => {
                if (code === 0) {
                    logCallback('Cài đặt các thư viện Python thành công!');
                    resolve();
                } else {
                    reject(new Error(`Cài đặt thư viện thất bại với mã lỗi: ${code}. Vui lòng chạy tay lệnh: pip install opentele telethon cryptography`));
                }
            });
        });
    }

    // Chạy action trong script converter.py
    runAction(action, params = {}, checkEnv = true, logCallback = null) {
        return new Promise(async (resolve, reject) => {
            try {
                let pythonCmd = 'python';
                if (checkEnv) {
                    pythonCmd = await this.getPythonCommand();
                }

                let targetScript = this.scriptPath;
                if (!fs.existsSync(targetScript)) {
                    const possiblePaths = [
                        path.join(process.cwd(), 'electron', 'python', 'converter.py'),
                        path.join(__dirname, 'python', 'converter.py'),
                        path.join(__dirname, 'converter.py')
                    ];
                    for (const p of possiblePaths) {
                        if (fs.existsSync(p)) {
                            targetScript = p;
                            break;
                        }
                    }
                }

                if (logCallback) {
                    logCallback(`[PythonService] Đang chạy action: ${action}...`);
                }

                const pyProcess = spawn(pythonCmd, [targetScript]);
                let stdoutData = '';
                let stderrData = '';

                pyProcess.stdout.on('data', (data) => {
                    stdoutData += data.toString();
                });

                pyProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                    if (logCallback) {
                        logCallback(`[Python-Stderr] ${data.toString().trim()}`);
                    }
                });

                pyProcess.on('close', (code) => {
                    try {
                        const trimmedOutput = stdoutData.trim();
                        if (!trimmedOutput) {
                            if (code !== 0) {
                                reject(new Error(`Python script thoát với code ${code} và không có output. Stderr: ${stderrData}`));
                            } else {
                                reject(new Error('Python script không trả về dữ liệu.'));
                            }
                            return;
                        }

                        let jsonResult;
                        try {
                            jsonResult = JSON.parse(trimmedOutput);
                        } catch (parseErr) {
                            const lines = trimmedOutput.split('\n');
                            for (let i = lines.length - 1; i >= 0; i--) {
                                try {
                                    jsonResult = JSON.parse(lines[i]);
                                    break;
                                } catch (e) {}
                            }
                            if (!jsonResult) {
                                reject(new Error(`Không thể parse JSON từ output của Python: ${trimmedOutput}`));
                                return;
                            }
                        }

                        if (jsonResult.status === 'error') {
                            const pyError = new Error(jsonResult.message || 'Lỗi không xác định từ Python script.');
                            pyError.pythonResult = jsonResult;
                            pyError.errorCode = jsonResult.error_code;
                            pyError.retryAfter = jsonResult.retry_after;
                            reject(pyError);
                        } else {
                            resolve(jsonResult);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });

                const payload = { action, ...params };
                pyProcess.stdin.write(JSON.stringify(payload));
                pyProcess.stdin.end();

            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = new PythonService();
