// Provider fixture: distinguish requirements, proof, challenge and observer data
// so integration tests can verify that each request carries the right evidence.
export const sentinelSDK = `
var SentinelSDK=function(t){
  var observation;
  var P={
    getRequirementsToken:async()=>"gAAAAACrequirements",
    getEnforcementToken:async challenge=>"gAAAAABproof-"+challenge.token
  };
  function D(challenge,requirements){if(requirements!=="gAAAAACrequirements")throw Error("Wrong requirements")}
  async function _n(challenge){return challenge.turnstile?.reject?null:"turnstile-evidence"}
  function se(flow,challenge){observation={so:"observer-evidence",c:challenge.token,flow}}
  t.sessionObserverToken=async()=>JSON.stringify(observation);
  t.token=ye;
  function ye(){}
  return t.token=ye,t}({});
`
