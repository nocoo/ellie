// components/forum/user-avatar.tsx — Avatar component
// Uses /api/avatar/:uid proxy which handles fallback server-side.

interface UserAvatarProps {
	src: string;
	alt: string;
	className?: string;
}

export function UserAvatar({ src, alt, className }: UserAvatarProps) {
	return <img src={src} alt={alt} className={className} loading="lazy" />;
}
