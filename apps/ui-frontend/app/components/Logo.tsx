import logo from '~/assets/logo.png';

export function Logo({ alt = '', className = 'h-11 w-11' }: { alt?: string; className?: string }) {
  return <img src={logo} alt={alt} className={`shrink-0 object-contain ${className}`} />;
}
