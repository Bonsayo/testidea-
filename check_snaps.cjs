var {ConvexHttpClient}=require('convex/browser');
require('dotenv').config({path:'.env.local'});
var c=new ConvexHttpClient(process.env.CONVEX_URL);
c.query('queries:getMatchHistory').then(async function(h){
  var withSnaps=0;
  for(var m of h.slice(0,10)){
    var s=await c.query('queries:getQuarterScores',{matchId:m.matchId});
    if(s&&s.length>0){
      withSnaps++;
      console.log('HAS SNAPS: '+m.matchName);
      s.forEach(function(q){console.log('  '+q.quarter+': '+q.homeScore+'-'+q.awayScore)});
    }
  }
  console.log('Matches with snaps in top 10: '+withSnaps);
}).catch(function(e){console.log('Error:',e.message)});
