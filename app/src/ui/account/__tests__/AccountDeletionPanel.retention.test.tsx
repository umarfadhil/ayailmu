import { fireEvent, render } from '@testing-library/react-native';
import type { AccountDeletionModel } from '@/ui/AccountContext';
import { AccountDeletionPanel } from '../AccountDeletionPanel';
it('offers the complete retained-data reasons including future server categories',async()=>{
 const proof={deletion_id:'5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687',account_id:'3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01',requested_at:'2026-10-23T02:00:00Z',server_data:{status:'erased' as const,erased_at:'2026-10-23T02:00:00Z',profiles:0,device_links:0,events:0,imports:0},status:'identity_deletion_pending' as const,identity_provider:{status:'pending' as const,attempts:1},not_deleted:[{what:'deletion_record',why:'Record retention not finalized'},{what:'later_kind',why:'Future retained category explanation'},{what:'device_data',why:'Other devices remain out of reach'}]};
 const model:AccountDeletionModel={key:'A',state:{phase:'pending',local:'erased',busy:false,proof},available:true,remove:jest.fn(),check:jest.fn(),retryIdentity:jest.fn(),retryCleanup:jest.fn()};const v=await render(<AccountDeletionPanel model={model}/>);await fireEvent.press(v.getByTestId('deletion-retention'));for(const entry of proof.not_deleted)expect(v.getByText(entry.why,{exact:false})).toBeTruthy();
});
