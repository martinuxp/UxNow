use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[cfg(windows)]
pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    use windows::Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        },
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .ok()
            .and_then(|device| device.GetId().ok())
            .and_then(|id| id.to_string().ok());
        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for index in 0..collection.GetCount().map_err(|e| e.to_string())? {
            let device = collection.Item(index).map_err(|e| e.to_string())?;
            let id = device
                .GetId()
                .map_err(|e| e.to_string())?
                .to_string()
                .map_err(|e| e.to_string())?;
            let name = device
                .OpenPropertyStore(STGM_READ)
                .ok()
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName).ok())
                .map(|value| value.to_string())
                .unwrap_or_else(|| id.clone());
            result.push(AudioDevice {
                is_default: default_id.as_deref() == Some(id.as_str()),
                id,
                name,
            });
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
pub fn set_process_volume(device_id: &str, process_id: u32, volume: f32) -> Result<(), String> {
    use windows::{
        core::Interface,
        Win32::{
            Media::Audio::{
                IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
                ISimpleAudioVolume, MMDeviceEnumerator,
            },
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
        },
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
        let device = enumerator
            .GetDevice(windows::core::PCWSTR(wide.as_ptr()))
            .map_err(|e| e.to_string())?;
        let manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let sessions = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for index in 0..sessions.GetCount().map_err(|e| e.to_string())? {
            let control = sessions.GetSession(index).map_err(|e| e.to_string())?;
            let control2: IAudioSessionControl2 = control.cast().map_err(|e| e.to_string())?;
            if control2.GetProcessId().map_err(|e| e.to_string())? == process_id {
                let simple: ISimpleAudioVolume = control.cast().map_err(|e| e.to_string())?;
                simple
                    .SetMasterVolume(volume.clamp(0.0, 1.0), std::ptr::null())
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        Err(crate::i18n::msg("backend.audio.sessionUnavailable"))
    }
}

#[cfg(not(windows))]
pub fn set_process_volume(_: &str, _: u32, _: f32) -> Result<(), String> {
    Err(crate::i18n::msg("backend.audio.windowsOnly"))
}

#[cfg(windows)]
pub fn set_keep_awake(active: bool) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    unsafe {
        let _ = SetThreadExecutionState(if active {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        } else {
            ES_CONTINUOUS
        });
    }
}

#[cfg(not(windows))]
pub fn set_keep_awake(_: bool) {}
