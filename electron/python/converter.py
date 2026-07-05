import sys
import os
import json
import asyncio
import re
import tempfile

# Đặt đường dẫn chứa script lên hàng đầu để ưu tiên module imghdr polyfill cục bộ
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Monkey patch opentele để khắc phục lỗi không tương thích phiên bản và thuộc tính ẩn trong Python 3.13+
try:
    import types
    
    # Mock opentele.td and opentele.tl để tránh kích hoạt import loop dẫn đến crash khi nạp opentele.utils
    mock_td = types.ModuleType('opentele.td')
    sys.modules['opentele.td'] = mock_td
    mock_tl = types.ModuleType('opentele.tl')
    sys.modules['opentele.tl'] = mock_tl
    
    import opentele.utils
    
    def patched_extend_class_new(cls, decorated_cls, isOverride=False):
        if not isinstance(cls, type):
            raise BaseException("@extend_class decorator is only for classes, not functions")
        newAttributes = dict(decorated_cls.__dict__)
        crossDelete = ["__abstractmethods__", "__module__", "_abc_impl", "__doc__", "__firstlineno__"]
        for cross in crossDelete:
            if cross in newAttributes:
                newAttributes.pop(cross)
        crossDelete_dict = {}
        base = decorated_cls.__bases__[0]
        if not isOverride:
            for attributeName, attributeValue in newAttributes.items():
                result = opentele.utils.extend_class.getattr(base, attributeName)
                if result is not None:
                    if id(result["value"]) == id(attributeValue):
                        crossDelete_dict[attributeName] = attributeValue
                    else:
                        if not opentele.utils.override.isOverride(attributeValue):
                            # Bỏ qua check trùng phương thức/thuộc tính và thuộc tính ẩn
                            crossDelete_dict[attributeName] = attributeValue
            for cross in crossDelete_dict:
                if cross in newAttributes:
                    newAttributes.pop(cross)
        for attributeName, attributeValue in newAttributes.items():
            result = opentele.utils.extend_class.getattr(base, attributeName)
            if result is not None:
                setattr(base, f"__{decorated_cls.__name__}__{attributeName}", result["value"])
                setattr(decorated_cls, f"__{decorated_cls.__name__}__{attributeName}", result["value"])
            setattr(base, attributeName, attributeValue)
        return decorated_cls
        
    opentele.utils.extend_class.__new__ = patched_extend_class_new
except BaseException as e:
    sys.stderr.write(f"Patch opentele error: {str(e)}\n")
finally:
    try:
        import types
        if 'opentele.td' in sys.modules and isinstance(sys.modules['opentele.td'], types.ModuleType) and not hasattr(sys.modules['opentele.td'], '__file__'):
            del sys.modules['opentele.td']
        if 'opentele.tl' in sys.modules and isinstance(sys.modules['opentele.tl'], types.ModuleType) and not hasattr(sys.modules['opentele.tl'], '__file__'):
            del sys.modules['opentele.tl']
        if 'opentele' in sys.modules:
            opentele_mod = sys.modules['opentele']
            if hasattr(opentele_mod, 'td') and not hasattr(getattr(opentele_mod, 'td'), '__file__'):
                delattr(opentele_mod, 'td')
            if hasattr(opentele_mod, 'tl') and not hasattr(getattr(opentele_mod, 'tl'), '__file__'):
                delattr(opentele_mod, 'tl')
    except:
        pass

# Tự động import opentele và telethon
# Tránh in bất cứ thứ gì ra stdout ngoại trừ JSON kết quả
try:
    from opentele.td import TDesktop
    from opentele.api import API
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    import opentele.td.account
except ImportError as e:
    # Trả về JSON thông báo thiếu thư viện
    print(json.dumps({"status": "error", "error_type": "import_error", "message": str(e)}))
    sys.exit(1)

TELEGRAM_API_ID = int(os.environ.get("TELEGRAM_API_ID", "2040"))
TELEGRAM_API_HASH = os.environ.get("TELEGRAM_API_HASH", "b18441a1ff607e10a989891a5462e627")
TELEGRAM_DEVICE_MODEL = os.environ.get("TELEGRAM_DEVICE_MODEL", "Desktop")
TELEGRAM_SYSTEM_VERSION = os.environ.get("TELEGRAM_SYSTEM_VERSION", "Windows 10")
TELEGRAM_APP_VERSION = os.environ.get("TELEGRAM_APP_VERSION", "Telegram Desktop 6.9.3 x64")
TELEGRAM_LANG_CODE = os.environ.get("TELEGRAM_LANG_CODE", "en")
TELEGRAM_SYSTEM_LANG_CODE = os.environ.get("TELEGRAM_SYSTEM_LANG_CODE", "en-US")
LOGIN_SESSION_DIR = os.path.join(tempfile.gettempdir(), "telegram_auto_post_login")


def get_telegram_api():
    if TELEGRAM_API_ID == 2040 and TELEGRAM_API_HASH == "b18441a1ff607e10a989891a5462e627":
        return API.TelegramDesktop
    return API.TelegramDesktop.Generate(system="windows", unique_id=f"telegram_auto_post_{TELEGRAM_API_ID}")


def get_client_kwargs():
    return {
        "device_model": TELEGRAM_DEVICE_MODEL,
        "system_version": TELEGRAM_SYSTEM_VERSION,
        "app_version": TELEGRAM_APP_VERSION,
        "lang_code": TELEGRAM_LANG_CODE,
        "system_lang_code": TELEGRAM_SYSTEM_LANG_CODE,
        "connection_retries": 3,
    }


def get_login_session_name(phone):
    os.makedirs(LOGIN_SESSION_DIR, exist_ok=True)
    safe_phone = re.sub(r"[^0-9A-Za-z_+-]", "_", str(phone or "unknown"))
    return os.path.join(LOGIN_SESSION_DIR, f"temp_login_{safe_phone}")


def cleanup_login_session(session_name):
    for suffix in (".session", ".session-journal"):
        try:
            path = f"{session_name}{suffix}"
            if os.path.exists(path):
                os.remove(path)
        except BaseException:
            pass


def format_telegram_error(error):
    message = str(error)
    error_code = getattr(error, "message", None) or error.__class__.__name__
    retry_after = getattr(error, "seconds", None)
    match = re.search(r"(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD)_(\d+)", message)
    if retry_after is None and match:
        retry_after = int(match.group(1))
    return {
        "status": "error",
        "message": message,
        "error_code": str(error_code),
        "retry_after": retry_after,
    }

def patched_map_data_read(self, localKey, legacyPasscode):
    import opentele.td.shared as td
    from opentele.exception import OpenTeleException, ExpectStreamStatus, Expects
    from opentele.td.configs import QByteArray, lskType, PeerId, FileKey
    
    try:
        mapData = td.Storage.ReadFile("map", self.basePath)
    except OpenTeleException as e:
        raise Exception("Could not read map data") from e

    legacySalt, legacyKeyEncrypted, mapEncrypted = (
        QByteArray(),
        QByteArray(),
        QByteArray(),
    )

    mapData.stream >> legacySalt >> legacyKeyEncrypted >> mapEncrypted
    ExpectStreamStatus(mapData.stream, "Could not stream data from mapData")

    if not localKey:
        Expects(
            legacySalt.size() == 32,
            Exception(f"Bad salt in map file, size: {legacySalt.size()}"),
        )
        legacyPasscodeKey = td.Storage.CreateLegacyLocalKey(legacySalt, legacyPasscode)
        try:
            keyData = td.Storage.DecryptLocal(legacyKeyEncrypted, legacyPasscodeKey)
        except OpenTeleException as e:
            raise Exception("Could not decrypt pass-protected key") from e
        localKey = td.AuthKey.FromStream(keyData.stream)

    try:
        map = td.Storage.DecryptLocal(mapEncrypted, localKey)
    except OpenTeleException as e:
        raise Exception("Could not decrypt map data") from e

    selfSerialized = QByteArray()
    draftsMap = {}
    draftCursorsMap = {}
    draftsNotReadMap = {}

    locationsKey = 0
    reportSpamStatusesKey = 0
    trustedBotsKey = 0
    recentStickersKeyOld = 0
    installedStickersKey = 0
    featuredStickersKey = 0
    recentStickersKey = 0
    favedStickersKey = 0
    archivedStickersKey = 0
    installedMasksKey = 0
    recentMasksKey = 0
    archivedMasksKey = 0
    savedGifsKey = 0
    legacyBackgroundKeyDay = 0
    legacyBackgroundKeyNight = 0
    userSettingsKey = 0
    recentHashtagsAndBotsKey = 0
    exportSettingsKey = 0

    try:
        while not map.stream.atEnd():
            keyType = map.stream.readUInt32()

            if keyType == lskType.lskDraft:
                count = map.stream.readUInt32()
                for i in range(count):
                    key = FileKey(map.stream.readUInt64())
                    peerIdSerialized = map.stream.readUInt64()
                    peerId = PeerId.FromSerialized(peerIdSerialized)
                    draftsMap[peerId] = key
                    draftsNotReadMap[peerId] = True

            elif keyType == lskType.lskSelfSerialized:
                map.stream >> selfSerialized

            elif keyType == lskType.lskDraftPosition:
                count = map.stream.readUInt32()
                for i in range(count):
                    key = FileKey(map.stream.readUInt64())
                    peerIdSerialized = map.stream.readUInt64()
                    peerId = PeerId.FromSerialized(peerIdSerialized)
                    draftCursorsMap[peerId] = key

            elif (
                (keyType == lskType.lskLegacyImages)
                or (keyType == lskType.lskLegacyStickerImages)
                or (keyType == lskType.lskLegacyAudios)
            ):
                count = map.stream.readUInt32()
                for i in range(count):
                    filekey = map.stream.readUInt64()
                    first = map.stream.readUInt64()
                    second = map.stream.readUInt64()
                    size = map.stream.readInt32()

            elif keyType == lskType.lskLocations:
                locationsKey = map.stream.readUInt64()

            elif keyType == lskType.lskReportSpamStatusesOld:
                reportSpamStatusesKey = map.stream.readUInt64()

            elif keyType == lskType.lskTrustedBots:
                trustedBotsKey = map.stream.readUInt64()

            elif keyType == lskType.lskRecentStickersOld:
                recentStickersKeyOld = map.stream.readUInt64()

            elif keyType == lskType.lskBackgroundOldOld:
                map.stream >> legacyBackgroundKeyDay

            elif keyType == lskType.lskBackgroundOld:
                legacyBackgroundKeyDay = map.stream.readUInt64()
                legacyBackgroundKeyNight = map.stream.readUInt64()

            elif keyType == lskType.lskUserSettings:
                userSettingsKey = map.stream.readUInt64()

            elif keyType == lskType.lskRecentHashtagsAndBots:
                recentHashtagsAndBotsKey = map.stream.readUInt64()

            elif keyType == lskType.lskStickersOld:
                installedStickersKey = map.stream.readUInt64()

            elif keyType == lskType.lskStickersKeys:
                installedStickersKey = map.stream.readUInt64()
                featuredStickersKey = map.stream.readUInt64()
                recentStickersKey = map.stream.readUInt64()
                archivedStickersKey = map.stream.readUInt64()

            elif keyType == lskType.lskFavedStickers:
                favedStickersKey = map.stream.readUInt64()

            elif keyType == lskType.lskSavedGifsOld:
                key = map.stream.readUInt64()

            elif keyType == lskType.lskSavedGifs:
                savedGifsKey = map.stream.readUInt64()

            elif keyType == lskType.lskSavedPeersOld:
                key = map.stream.readUInt64()

            elif keyType == lskType.lskExportSettings:
                exportSettingsKey = map.stream.readUInt64()

            elif keyType == lskType.lskMasksKeys:
                installedMasksKey = map.stream.readUInt64()
                recentMasksKey = map.stream.readUInt64()
                archivedMasksKey = map.stream.readUInt64()

            else:
                # Bỏ qua warning để tránh ghi log ra stdout/stderr làm nhiễu JSON parsing
                break

            ExpectStreamStatus(map.stream, "Could not stream data from mapData ")
    except Exception:
        pass

    self._MapData__localKey = localKey
    self._draftsMap = draftsMap
    self._draftCursorsMap = draftCursorsMap
    self._draftsNotReadMap = draftsNotReadMap

    self._locationsKey = locationsKey
    self._trustedBotsKey = trustedBotsKey
    self._recentStickersKeyOld = recentStickersKeyOld
    self._installedStickersKey = installedStickersKey
    self._featuredStickersKey = featuredStickersKey
    self._recentStickersKey = recentStickersKey
    self._favedStickersKey = favedStickersKey
    self._archivedStickersKey = archivedStickersKey
    self._savedGifsKey = savedGifsKey
    self._installedMasksKey = installedMasksKey
    self._recentMasksKey = recentMasksKey
    self._archivedMasksKey = archivedMasksKey
    self._legacyBackgroundKeyDay = legacyBackgroundKeyDay
    self._legacyBackgroundKeyNight = legacyBackgroundKeyNight
    self._settingsKey = userSettingsKey
    self._recentHashtagsAndBotsKey = recentHashtagsAndBotsKey
    self._exportSettingsKey = exportSettingsKey
    self._oldMapVersion = mapData.version

# Áp dụng monkey patch cho MapData.read
opentele.td.account.MapData.read = patched_map_data_read

async def patched_from_tdesktop(
    account,
    session = None,
    flag = None,
    api = None,
    password = None,
    **kwargs
):
    import opentele.td.shared as td
    from opentele.exception import Expects, TDesktopNotLoaded, TDesktopHasNoAccount, TDesktopUnauthorized, LoginFlagInvalid
    from opentele.td.configs import CreateNewSession, UseCurrentSession
    from opentele.tl.telethon import TelegramClient
    from telethon.sessions import MemorySession, SQLiteSession, Session
    from telethon.crypto import AuthKey
    import warnings
    
    if flag is None:
        flag = CreateNewSession
    if api is None:
        from opentele.api import API
        api = API.TelegramDesktop
    
    Expects(
        (flag == CreateNewSession) or (flag == UseCurrentSession),
        LoginFlagInvalid("LoginFlag invalid"),
    )

    if isinstance(account, td.TDesktop):
        Expects(
            account.isLoaded(),
            TDesktopNotLoaded("You need to load accounts from a tdata folder first"),
        )
        Expects(
            account.accountsCount > 0,
            TDesktopHasNoAccount("There is no account in this instance of TDesktop"),
        )
        assert account.mainAccount
        account = account.mainAccount

    if (flag == UseCurrentSession) and not (
        isinstance(api, opentele.api.APIData) or opentele.api.APIData.__subclasscheck__(api)
    ):
        warnings.warn(
            "\nIf you use an existing Telegram Desktop session "
            "with unofficial API_ID and API_HASH, "
            "Telegram might ban your account because of suspicious activities.\n"
            "Please use the default APIs to get rid of this."
        )

    endpoints = account._local.config.endpoints(account.MainDcId)
    address = td.MTP.DcOptions.Address.IPv4
    protocol = td.MTP.DcOptions.Protocol.Tcp

    Expects(len(endpoints[address][protocol]) > 0, "Couldn't find endpoint for this account, something went wrong?")
    endpoint = endpoints[address][protocol][0]

    if flag == CreateNewSession:
        auth_session = MemorySession()
    else:
        if isinstance(session, str) or session is None:
            try:
                auth_session = SQLiteSession(session)
            except ImportError:
                warnings.warn(
                    "The sqlite3 module is not available under this "
                    "Python installation and no custom session "
                    "instance was given; using MemorySession.\n"
                    "You will need to re-login every time unless "
                    "you use another session storage"
                )
                auth_session = MemorySession()
        elif isinstance(session, Session):
            auth_session = session
        else:
            raise TypeError(
                "The given session must be a str or a Session instance."
            )

    auth_session.set_dc(endpoint.id, endpoint.ip, endpoint.port)
    auth_session.auth_key = AuthKey(account.authKey.key)

    client = TelegramClient(auth_session, api=account.api, **kwargs)

    if flag == UseCurrentSession:
        client.UserId = account.UserId
        return client

    await client.connect()
    Expects(
        await client.is_user_authorized(),
        TDesktopUnauthorized("TDesktop client is unauthorized"),
    )

    return await client.QRLoginToNewClient(
        session=session, api=api, password=password, **kwargs
    )

import opentele.tl.telethon
opentele.tl.telethon.TelegramClient.FromTDesktop = patched_from_tdesktop

def get_desktop_api(unique_id="tdata_converter"):
    return API.TelegramDesktop.Generate(
        system="windows",
        unique_id=unique_id
    )

async def scan_tdata(tdata_dir, passcode=None):
    if not os.path.exists(tdata_dir):
        return {"status": "error", "message": f"Thu muc tdata khong ton tai: {tdata_dir}"}
    
    try:
        # Load tdata
        tdesk = TDesktop(tdata_dir, passcode=passcode)
        
        accounts_info = []
        for index, acc in enumerate(tdesk.accounts):
            user_id = getattr(acc, "userId", None)
            phone = getattr(acc, "phone", None)
            
            accounts_info.append({
                "index": index,
                "user_id": user_id,
                "phone": phone,
                "dc_id": getattr(acc, "dcId", None)
            })
            
        return {
            "status": "success",
            "accounts_count": len(tdesk.accounts),
            "accounts": accounts_info
        }
    except BaseException as e:
        return {"status": "error", "message": f"Loi doc Tdata: {str(e)}"}

async def tdata_to_session(tdata_dir, passcode, account_index, output_path, export_type="file", password=None):
    from opentele.td.configs import UseCurrentSession, CreateNewSession
    from opentele.exception import OpenTeleException
    
    try:
        tdesk = TDesktop(tdata_dir, passcode=passcode)
        if not tdesk.accounts or account_index >= len(tdesk.accounts):
            return {"status": "error", "message": f"Khong tim thay tai khoan voi index: {account_index}"}
        
        target_account = tdesk.accounts[account_index]
        
        async def do_convert(flag_type):
            if export_type == "string":
                session = StringSession()
                client = await target_account.ToTelethon(session=session, api=tdesk.api, flag=flag_type, password=password)
                await client.connect()
                session_str = client.session.save()
                await client.disconnect()
                return {
                    "status": "success",
                    "session_string": session_str
                }
            else:
                os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except:
                        pass
                client = await target_account.ToTelethon(session=output_path, api=tdesk.api, flag=flag_type, password=password)
                await client.connect()
                await client.disconnect()
                return {
                    "status": "success",
                    "output_path": output_path
                }

        # Thử convert bằng CreateNewSession trước
        try:
            return await do_convert(CreateNewSession)
        except BaseException as login_err:
            err_msg = str(login_err)
            sys.stderr.write(f"[Warning] CreateNewSession failed: {err_msg}. Falling back to UseCurrentSession...\n")
            try:
                return await do_convert(UseCurrentSession)
            except BaseException as fallback_err:
                return {"status": "error", "message": f"Loi convert (sau khi fallback): {str(fallback_err)} (Loi goc: {err_msg})"}
            
    except BaseException as e:
        return {"status": "error", "message": f"Loi convert TData -> Session: {str(e)}"}

async def session_to_tdata(session_source, is_string, api_id, api_hash, output_tdata_dir):
    try:
        os.makedirs(output_tdata_dir, exist_ok=True)
        
        # Khởi tạo api desktop
        api = get_desktop_api(f"convert_{api_id}")
        
        if is_string:
            session = StringSession(session_source)
        else:
            session = session_source
            if not os.path.exists(session):
                return {"status": "error", "message": f"File session khong ton tai: {session}"}
        
        client = TelegramClient(session, api_id, api_hash)
        await client.connect()
        
        if not await client.is_user_authorized():
            await client.disconnect()
            return {"status": "error", "message": "Session nay chua duoc dang nhap hoac da bi kick khoi Telegram."}
        
        # Chuyển đổi sang TDesktop
        tdesk = await TDesktop.FromTelethon(client, api=api)
        tdesk.SaveTData(output_tdata_dir)
        
        await client.disconnect()
        
        return {
            "status": "success",
            "output_dir": output_tdata_dir
        }
    except BaseException as e:
        return {"status": "error", "message": f"Loi convert Session -> TData: {str(e)}"}

async def test_passcode(tdata_dir, passcode):
    try:
        tdesk = TDesktop(tdata_dir, passcode=passcode)
        return {"status": "success", "valid": True, "accounts_count": len(tdesk.accounts)}
    except BaseException as e:
        return {"status": "success", "valid": False, "message": str(e)}

async def request_login_code(phone):
    if not phone:
        return {"status": "error", "message": "Phone number is required", "error_code": "PHONE_EMPTY"}

    session_name = get_login_session_name(phone)
    cleanup_login_session(session_name)
    client = TelegramClient(session_name, api=get_telegram_api(), **get_client_kwargs())
    await client.connect()
    try:
        result = await client.send_code_request(phone)
        return {
            "status": "success",
            "phone_code_hash": result.phone_code_hash
        }
    except BaseException as e:
        cleanup_login_session(session_name)
        return format_telegram_error(e)
    finally:
        await client.disconnect()

async def submit_login_code(phone, code, phone_code_hash, password=None):
    from telethon.errors import SessionPasswordNeededError
    if not phone or not code or not phone_code_hash:
        return {"status": "error", "message": "Missing phone, code, or phone_code_hash", "error_code": "LOGIN_INPUT_MISSING"}

    session_name = get_login_session_name(phone)
    client = TelegramClient(session_name, api=get_telegram_api(), **get_client_kwargs())
    await client.connect()
    try:
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not password:
                await client.disconnect()
                return {
                    "status": "password_needed",
                    "message": "Two-step verification is enabled."
                }
            await client.sign_in(password=password)
        
        session_str = StringSession.save(client.session)
        await client.disconnect()
        cleanup_login_session(session_name)
        
        return {
            "status": "success",
            "session_string": session_str
        }
    except BaseException as e:
        await client.disconnect()
        result = format_telegram_error(e)
        if result.get("error_code") not in ("SESSION_PASSWORD_NEEDED", "SessionPasswordNeededError"):
            cleanup_login_session(session_name)
        return result

async def main():
    # Đọc tham số từ stdin dưới dạng bytes và decode UTF-8 để tránh lỗi font chữ/mã hóa trên Windows
    try:
        input_bytes = sys.stdin.buffer.read()
        input_data = input_bytes.decode('utf-8').strip()
        if not input_data:
            print(json.dumps({"status": "error", "message": "Khong nhan duoc du lieu input qua stdin"}))
            return
        
        params = json.loads(input_data)
        action = params.get("action")
        
        if action == "scan_tdata":
            result = await scan_tdata(
                params.get("tdata_dir"), 
                params.get("passcode")
            )
        elif action == "tdata_to_session":
            result = await tdata_to_session(
                params.get("tdata_dir"),
                params.get("passcode"),
                params.get("account_index", 0),
                params.get("output_path"),
                params.get("export_type", "file"),
                password=params.get("password")
            )
        elif action == "session_to_tdata":
            result = await session_to_tdata(
                params.get("session_source"),
                params.get("is_string", False),
                int(params.get("api_id")),
                params.get("api_hash"),
                params.get("output_tdata_dir")
            )
        elif action == "test_passcode":
            result = await test_passcode(
                params.get("tdata_dir"),
                params.get("passcode")
            )
        elif action == "request_login_code":
            result = await request_login_code(
                params.get("phone")
            )
        elif action == "submit_login_code":
            result = await submit_login_code(
                params.get("phone"),
                params.get("code"),
                params.get("phone_code_hash"),
                params.get("password")
            )
        else:
            result = {"status": "error", "message": f"Hanh dong khong hop le: {action}"}
            
        print(json.dumps(result))
    except BaseException as e:
        print(json.dumps({"status": "error", "message": f"Loi runtime python: {str(e)}"}))

if __name__ == "__main__":
    # Đảm bảo encoding utf-8
    if sys.platform.startswith('win'):
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
        sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')
        
    asyncio.run(main())
