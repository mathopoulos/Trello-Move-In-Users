//------------------------------------------------------------------------------------------------------------
//User Editable Configurable Value
const daysSinceLastActive = 365; 

//------------------------------------------------------------------------------------------------------------
//REQUIRED authintication credentials
//These are the credentials required to authenticate with the the Trello API. 

const apiKey = 'API Key'; //Enter your personal API key
const apiToken = 'API Token'; //Enter your personal API token that was generated by the API key above
const enterpriseId = 'Enterprise ID'; //Enter the ID of the Trello Enterprise you want to add members to.

//------------------------------------------------------------------------------------------------------------
//Below this line is the main execution code. Edits below this line are not recommended unless you are trying to adapt the core funtionality of the script.


const fetch = require('node-fetch');
const moment = require('moment');
const fs = require('fs');
const headers = { 'Accept': 'application/json' };
const timestamp = moment().format("YYYY-MM-DD-HHmmss");
const workspaceReportsDir = 'Workspace_Reports';
const userReportsDir = 'Per_Workspace_User_Reports'

async function fetchWithTimeout(resource, options) {
  const { timeout = 50000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
}

async function putTogetherReport() {
  console.log("Starting to pull your Non-Enterprise Workspace...")
  const getNonEnterpriseWorkspaceUrl = `https://api.trello.com/1/enterprises/${enterpriseId}/claimableOrganizations?key=${apiKey}&token=${apiToken}`;
  let cursor = '';
  const csvHeaders = [['Workspace ID', 'Workspace Name', 'Member Count']];
  const csvWorkspaceHeaders = [['Workspace ID', 'Member Full Name', 'Member ID', 'Member Email', 'Days Since Active', 'Date Last Active', 'Deactivated']];
  fs.writeFileSync(`user_report_${timestamp}.csv`, csvWorkspaceHeaders.join(', ') + '\r\n');
  fs.writeFileSync(`${workspaceReportsDir}/workspace_report_${timestamp}.csv`, csvHeaders.join(', ') + '\r\n');
  while (true) {
    try {
      const response = await fetchWithTimeout(`${getNonEnterpriseWorkspaceUrl}&cursor=${cursor}`, { headers });
      if (!response.ok) throw new Error(`HTTP error - get non enterprise workspace! status: ${response.status}`);
      const body = await response.json();
      const workspaceResponse = body.organizations;
      for (const organization of workspaceResponse) {
        fs.appendFileSync(`${workspaceReportsDir}/workspace_report_${timestamp}.csv`, [organization.id, organization.name, organization.activeMembershipCount].join(', ') + '\r\n');
        await addWorkspaceToEnterprise(organization.id);
      }
      if (!body.cursor) break;
      cursor = body.cursor;
    } catch (error) {
      console.error(error);
    }
  }
  console.log('All done!')
}

const MAX_RETRIES = 3; // maximum number of times to retry the request
const RETRY_DELAY = 5000; // time to wait between retries in milliseconds

async function addWorkspaceToEnterprise(organizationID) {
  const addWorkspaceToEnterpriseURL = `https://api.trello.com/1/enterprises/${enterpriseId}/organizations?idOrganization=${organizationID}&key=${apiKey}&token=${apiToken}`;
  let retries = 0;
  while (retries < MAX_RETRIES) {
      try {
          const response = await fetchWithTimeout(addWorkspaceToEnterpriseURL, { method: 'PUT', headers });
          if (!response.ok) throw new Error(`HTTP error - addWorkspaceToEnterpise! status: ${response.status}`);
          console.log(`Added workspace ${organizationID} to Enterprise`);
          await getUsersAddToReportDeactivate(organizationID);
          return; // successful execution, so exit the function
      } catch (error) {
          console.error(`Attempt ${retries + 1} failed -`, error);
          if (retries === MAX_RETRIES - 1) { // last retry attempt
              console.error('Max retries reached. Failed to add workspace to enterprise.');
              break; // exit the loop after the last retry
          }
          console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          retries++;
      }
  }
}

async function getUsersAddToReportDeactivate(organizationID) {
  const getWorkspaceMembers = `https://api.trello.com/1/organizations/${organizationID}?fields=&member_activity=true&members=all&key=${apiKey}&token=${apiToken}`;

  try {
    const response = await fetchWithTimeout(getWorkspaceMembers, { headers });
    if (!response.ok) throw new Error(`HTTP error - getWorkspaceMembers! status: ${response.status}`);
    
    const body = await response.json();
    const membersResponse = body.members;
    console.log(`Deactivating inactive users of workspace(${organizationID})`);

    for (const member of membersResponse) {
      const getMemberDetails = `https://api.trello.com/1/enterprises/${enterpriseId}/members/${member.id}?fields=all&key=${apiKey}&token=${apiToken}`;

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          const memberDetailResponse = await fetchWithTimeout(getMemberDetails, { headers });
          if (!memberDetailResponse.ok) throw new Error(`HTTP error - git member details! status: ${memberDetailResponse.status}`);
          
          const memberDetail = await memberDetailResponse.json();
          const lastActiveDate = memberDetail.dateLastAccessed;
          const daysActive = moment().diff(moment(lastActiveDate), 'days');
          const eligible = (daysActive > daysSinceLastActive || isNaN(daysActive)) ? 'Yes' : 'No';

          fs.appendFileSync(`user_report_${timestamp}.csv`, [organizationID, member.fullName, member.id, member.memberEmail, daysActive, lastActiveDate, eligible].join(', ') + '\r\n');
          
          if (eligible === 'Yes') {
            await deactivateInactiveOrgUsers(enterpriseId, member.id);
          }
          break;  // exit the loop on success
        } catch (error) {
          console.error(`Attempt ${retries + 1} failed for member ${member.id} -`, error);
          if (retries === MAX_RETRIES - 1) {
            console.error(`Max retries reached for member ${member.id}. Moving on to the next member.`);
            break;
          }
          console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          retries++;
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function deactivateInactiveOrgUsers(enterpriseId, memberId) {
  const giveEnterpriseSeatUrl = `https://api.trello.com/1/enterprises/${enterpriseId}/members/${memberId}/licensed?key=${apiKey}&token=${apiToken}&value=false`;
  try {
    const response = await fetchWithTimeout(giveEnterpriseSeatUrl, { method: 'PUT', headers });
    if (!response.ok) throw new Error(`HTTP error! status - deactivating a user: ${response.status}: member: ${membedId}`);
    console.log(`Deactivated member: ${memberId}`);
  } catch (error) {
    console.error(error);
  }
}

putTogetherReport();

