import { initial, type Profile } from './profiles'

export function Avatar({ profile, size }: { profile: Pick<Profile, 'name' | 'color' | 'avatar'>; size: number }) {
  return (
    <span className="profile-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.37), background: profile.color }}>
      {profile.avatar ? <img src={profile.avatar} alt="" /> : initial(profile.name)}
    </span>
  )
}
