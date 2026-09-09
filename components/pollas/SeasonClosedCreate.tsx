// Legacy bookmarks go straight to the available house pools.
import { redirect } from 'next/navigation';
export default function SeasonClosedCreate() {
 redirect('/casa');
 return null;
}
