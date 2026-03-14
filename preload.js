const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 윈도우 제어
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),

  // 할 일
  getTodos:  () => ipcRenderer.invoke('todos:get'),
  saveTodos: (todos) => ipcRenderer.invoke('todos:save', todos),

  // 설정
  getSettings:  () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s)  => ipcRenderer.invoke('settings:save', s),

  // 배너
  getBanner:   () => ipcRenderer.invoke('banner:get'),
  saveBanner:  (d) => ipcRenderer.invoke('banner:save', d),
  clearBanner: () => ipcRenderer.invoke('banner:clear'),

  // 스티커
  getStickers:  () => ipcRenderer.invoke('stickers:get'),
  saveStickers: (s)  => ipcRenderer.invoke('stickers:save', s),

  // 일기
  getDiary:  () => ipcRenderer.invoke('diary:get'),
  saveDiary: (d) => ipcRenderer.invoke('diary:save', d),

  // 구글 캘린더
  startGoogleAuth: () => ipcRenderer.invoke('gcal:startAuth'),
  disconnectGoogle: () => ipcRenderer.invoke('gcal:disconnect'),
  fetchGoogleEvents: (params) => ipcRenderer.invoke('gcal:getEvents', params),

  // 알림
  notify:      (title, body) => ipcRenderer.send('notify', { title, body }),
  reschedule:  () => ipcRenderer.send('reschedule'),

  // 시작 프로그램
  getStartup: ()        => ipcRenderer.invoke('startup:get'),
  setStartup: (enable)  => ipcRenderer.invoke('startup:set', enable),

  // 창 크기 조절
  setWinZoom: (zoom) => ipcRenderer.invoke('win:setZoom', zoom),
});