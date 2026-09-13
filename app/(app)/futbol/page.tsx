import FootballCenter from '@/components/football/FootballCenter';
import coverage from '@/lib/teams/crest-coverage.json';
import { buildTeamCatalog } from '@/lib/teams/team-search';

// Built once on the server: the coverage file never enters the client bundle, only this deduplicated list.
const teams=buildTeamCatalog(coverage);
export default function FootballPage() {return <FootballCenter teams={teams}/>;}
