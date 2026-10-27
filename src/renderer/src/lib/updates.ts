import type { UpdateInfo } from '../../../shared/types'
import { api } from '../api'
import { toast } from '../state/ui'

/** Asks GitHub for the latest release, then tells the person what it found. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const info = await api.app.checkUpdate()
  if (info.error) {
    toast(`Could not check for updates: ${info.error}`, 'error')
  } else if (info.newer && info.latest) {
    const choice = await api.app.messageBox({
      type: 'info',
      message: `Hearth ${info.latest} is available`,
      detail: `You have version ${info.current}. The download page lists what changed.`,
      buttons: ['Open Download Page', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (choice === 0) api.app.openExternal(info.url)
  } else {
    toast(`Hearth ${info.current} is the latest version`, 'success')
  }
  return info
}
