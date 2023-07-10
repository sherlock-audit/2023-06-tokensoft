
# Tokensoft contest details

- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)

# Q&A

### Q: On what chains are the smart contracts going to be deployed?
Arbitrum, Optimism, Gnosis, Polygon
___

### Q: Which ERC20 tokens do you expect will interact with the smart contracts? 
NEXT - Standard ERC20 implementation.
___

### Q: Which ERC721 tokens do you expect will interact with the smart contracts? 
none
___

### Q: Which ERC777 tokens do you expect will interact with the smart contracts? 
none
___

### Q: Are there any FEE-ON-TRANSFER tokens interacting with the smart contracts?

no
___

### Q: Are there any REBASING tokens interacting with the smart contracts?

no
___

### Q: Are the admins of the protocols your contracts integrate with (if any) TRUSTED or RESTRICTED?
Yes, they are trusted. Admin should be able to clawback funds, reset the merkle root of beneficiaries, and may have other trusted priveleges. Changing the merkle root or clawing back funds could result in fund loss.
___

### Q: Is the admin/owner of the protocol/contracts TRUSTED or RESTRICTED?
Yes, they are trusted. Admin should be able to clawback funds, reset the merkle root of beneficiaries, and may have other trusted priveleges. Changing the merkle root or clawing back funds could result in fund loss.
___

### Q: Are there any additional protocol roles? If yes, please explain in detail:
No, only an owner.
___

### Q: Is the code/contract expected to comply with any EIPs? Are there specific assumptions around adhering to those EIPs that Watsons should be aware of?
No.
___

### Q: Please list any known issues/acceptable risks that should not result in a valid finding.
N/A.
___

### Q: Please provide links to previous audits (if any).
N/A.
___

### Q: Are there any off-chain mechanisms or off-chain procedures for the protocol (keeper bots, input validation expectations, etc)?
Not directly on the contracts, but there are in the crosschain protocol used (Connext).
___

### Q: In case of external protocol integrations, are the risks of external contracts pausing or executing an emergency withdrawal acceptable? If not, Watsons will submit issues related to these situations that can harm your protocol's functionality.
Yes.
___

### Q: Do you expect to use any of the following tokens with non-standard behaviour with the smart contracts?
No.
___

### Q: Add links to relevant protocol resources
Documentation of Usage: 
https://connext.notion.site/External-Spec-Crosschain-Airdrops-1ee0e3def3314b61bf954d44d19640d7?pvs=4

Connext: 
https://docs.connext.network/
https://github.com/connext/audits
___



# Audit scope

