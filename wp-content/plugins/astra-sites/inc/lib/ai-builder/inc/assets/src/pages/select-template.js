import {
	useState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useReducer,
} from '@wordpress/element';
import { twMerge } from 'tailwind-merge';
import { useSelect, useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import NavigationButtons from '../components/navigation-buttons';
import { classNames, toastBody } from '../helpers';
import { STORE_KEY } from '../store';
import { ColumnItem } from '../components/column-item';
import Input from '../components/input';
import {
	ChevronUpIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { useDebounce } from '../hooks/use-debounce';
import ColumnSkeleton from '../components/column-skeleton';
import {
	clearSessionStorage,
	getFromSessionStorage,
	setToSessionStorage,
} from '../utils/helpers';
import { useNavigateSteps } from '../router';
import Button from '../components/button';
import LoadingSpinner from '../components/loading-spinner';
import { __ } from '@wordpress/i18n';
import toast from 'react-hot-toast';
import Heading from '../components/heading';
import { SelectTemplatePageBuilderDropdown } from '../components/page-builder-dropdown';
export const USER_KEYWORD = 'st-template-search';

const SelectTemplate = () => {
	const { previousStep } = useNavigateSteps();

	const {
		setWebsiteTemplatesAIStep,
		setWebsiteSelectedTemplateAIStep,
		setWebsiteTemplateSearchResultsAIStep,
		setSelectedTemplateIsPremium,
	} = useDispatch( STORE_KEY );

	const {
		stepsData: {
			businessName,
			businessType,
			templateSearchResults,
			templateList: allTemplates,
			templateKeywords: keywords = [],
		},
	} = useSelect( ( select ) => {
		const { getAIStepData, getAllPatternsCategories, getOnboardingAI } =
			select( STORE_KEY );

		const onboardingAI = getOnboardingAI();

		return {
			stepsData: getAIStepData(),
			allPatternsCategories: getAllPatternsCategories(),
			isNewUser: onboardingAI?.isNewUser,
		};
	}, [] );

	const {
		register,
		handleSubmit,
		formState: { errors },
		reset,
		setFocus,
		watch,
		getValues,
	} = useForm( {
		defaultValues: {
			keyword:
				getFromSessionStorage( USER_KEYWORD ) ??
				keywords?.join( ', ' ) ??
				'',
		},
	} );
	const watchedKeyword = watch( 'keyword' );
	const debouncedKeyword = useDebounce( watchedKeyword, 300 );

	const [ isFetching, setIsFetching ] = useState( false );
	const [ backToTop, setBackToTop ] = useState( false );
	const [ selectedBuilder, setSelectedBuilder ] = useState( 'spectra' );

	const parentContainer = useRef( null );
	const templatesContainer = useRef( null );
	const abortRequest = useRef( [] );

	const [ loadMoreTemplates, setLoadMoreTemplates ] = useReducer(
		( state, updatedState ) => {
			return {
				...state,
				...updatedState,
			};
		},
		{
			page: 1,
			loading: false,
			showLoadMore: false,
		}
	);

	const TEMPLATE_TYPE = {
		RECOMMENDED: 'recommended',
		PARTIAL: 'partial',
		GENERIC: 'generic',
	};

	const refinedSearchResults = useMemo( () => {
		if ( ! templateSearchResults?.length ) {
			return [];
		}

		return templateSearchResults.reduceRight( ( acc, item, index ) => {
			if ( ! item.designs?.length ) {
				return acc;
			}
			const otherDesigns = acc
				.filter( ( designItem ) => item.match !== designItem.match )
				.flatMap( ( otherItem ) => otherItem.designs );

			const updatedDesigns = item.designs.filter(
				( designItem ) =>
					! otherDesigns.find(
						( otherDesign ) => otherDesign.uuid === designItem.uuid
					)
			);

			acc[ index ] = { ...item, designs: updatedDesigns };
			return acc;
		}, templateSearchResults );
	}, [ templateSearchResults ] );

	const getTemplates = useCallback(
		( type ) => {
			const { RECOMMENDED, GENERIC, PARTIAL } = TEMPLATE_TYPE;
			switch ( type ) {
				case RECOMMENDED:
					return refinedSearchResults?.[ 0 ]?.designs || [];
				case PARTIAL:
					return refinedSearchResults?.[ 1 ]?.designs || [];
				case GENERIC:
					return refinedSearchResults?.[ 2 ]?.designs || [];
			}
		},
		[ refinedSearchResults ]
	);

	const getInitialUserKeyword = () => {
		const type = businessType.toLowerCase();
		if ( type !== 'others' ) {
			return type;
		} else if ( keywords?.length > 0 ) {
			return keywords[ 0 ];
		}
		return businessName;
	};

	const handleHiddenTemplates = ( result ) => {
		// Hide ecommerce templates if ecommerce is disabled in the AI Builder settings.
		const hideEcommerceTemplates =
			aiBuilderVars?.hide_site_features?.includes( 'ecommerce' );
		// Hide premium templates if `show_premium_template` is false.
		const hidePremiumTemplates = ! aiBuilderVars?.show_premium_templates;

		if ( hidePremiumTemplates ) {
			result = result.map( ( item ) => {
				return {
					...item,
					designs: item?.designs?.filter(
						( template ) => ! template.is_premium
					),
				};
			} );
		}

		if ( hideEcommerceTemplates ) {
			result = result.map( ( item ) => {
				return {
					...item,
					designs: item?.designs?.filter(
						( template ) => template.features.ecommerce !== 'yes'
					),
				};
			} );
		}

		return result;
	};

	const fetchTemplates = async ( keyword = getInitialUserKeyword() ) => {
		if ( ! keyword ) {
			return;
		}

		try {
			setIsFetching( true );
			if ( abortRequest.current.length ) {
				abortRequest.current.forEach( ( controller ) => {
					controller.abort();
				} );
				abortRequest.current = [];
			}
			setWebsiteTemplatesAIStep( [] );

			const finalKeywords = [
				...new Set(
					keyword
						.split( ',' )
						.map( ( item ) => item.trim()?.toLowerCase() )
				),
			];

			let results = [];
			const allTemplatesList = [];

			const promises = finalKeywords.map( async ( keywordItem ) => {
				const abortController = new AbortController();
				abortRequest.current.push( abortController );
				const response = await apiFetch( {
					path: 'zipwp/v1/templates',
					method: 'POST',
					data: {
						keyword: keywordItem,
						business_name: businessName,
						page_builder: selectedBuilder,
					},
					signal: abortController.signal,
				} );
				let result = response?.data?.data || [];

				// Filter out Hidden templates based on the settings.
				result = handleHiddenTemplates( result );

				if ( results.length === 0 ) {
					results = result;
				} else {
					result.forEach( ( item, indx ) => {
						if ( item?.designs?.length > 0 ) {
							results[ indx ].designs = [
								...results[ indx ].designs,
								...item.designs.filter(
									( template ) =>
										! results[ indx ].designs.find(
											( existingTemplate ) =>
												existingTemplate.uuid ===
												template.uuid
										)
								),
							];
						}
					} );
				}

				// Get the the designs in sequence
				result.forEach( ( item ) => {
					if ( Array.isArray( item.designs ) ) {
						allTemplatesList.push(
							...item.designs.filter(
								( template ) =>
									! allTemplatesList.find(
										( existingTemplate ) =>
											existingTemplate.uuid ===
											template.uuid
									)
							)
						);
					}
				} );

				setWebsiteTemplatesAIStep( [ ...allTemplatesList ] );
				setWebsiteTemplateSearchResultsAIStep( [ ...results ] );
				setIsFetching( false );
				const isEmptyResults = allTemplatesList.length === 0;
				let showLoadMoreTemplates = true;

				if ( isEmptyResults ) {
					showLoadMoreTemplates = false;
				}
				setLoadMoreTemplates( { showLoadMore: showLoadMoreTemplates } );

				return true;
			} );

			await Promise.all( promises );

			if ( allTemplatesList.length < 4 ) {
				fetchAllTemplatesByPage( 1, {
					searchResults: results,
					templateList: allTemplatesList,
					showLoadMoreTemplates: loadMoreTemplates.showLoadMore,
				} );
			}
		} catch ( error ) {
			if ( error?.name === 'AbortError' ) {
				return;
			}
			setIsFetching( false );
		}
	};

	const fetchAllTemplatesByPage = async (
		page = 1,
		{
			searchResults = templateSearchResults,
			templateList = allTemplates,
			_showLoadMoreTemplates = loadMoreTemplates,
		} = {}
	) => {
		try {
			if ( loadMoreTemplates.loading || ! _showLoadMoreTemplates ) {
				return;
			}

			setLoadMoreTemplates( { loading: true } );

			const response = await apiFetch( {
				path: 'zipwp/v1/all-templates',
				method: 'POST',
				data: {
					business_name: businessName,
					page_builder: selectedBuilder,
					per_page: 9,
					page,
				},
			} );

			if ( ! response.success ) {
				throw new Error(
					response?.data?.data ??
						__( 'Error while fetching templates', 'ai-builder' )
				);
			}

			let result = response?.data?.data?.result || [];
			const lastPage = response?.data?.data?.lastPage || 1;

			// Filter out Hidden templates based on the settings.

			result = handleHiddenTemplates( result );

			const updatedAllTemplates = [
				...templateList,
				...result.map( ( item ) => item.designs ).flat(),
			];

			const updatedSearchResults = [ ...searchResults ];

			result.forEach( ( item ) => {
				if ( ! item?.match ) {
					return;
				}
				const indx = updatedSearchResults.findIndex(
					( searchResult ) => searchResult?.match === item?.match
				);
				if ( indx !== -1 ) {
					const existingDesigns = updatedSearchResults[
						indx
					].designs.map( ( design ) => design.uuid );
					const newDesigns = item.designs.filter(
						( designItem ) =>
							! existingDesigns.includes( designItem.uuid )
					);
					updatedSearchResults[ indx ].designs = [
						...updatedSearchResults[ indx ].designs,
						...newDesigns,
					];
				}
			} );

			setWebsiteTemplatesAIStep( updatedAllTemplates );
			setWebsiteTemplateSearchResultsAIStep( updatedSearchResults );

			if ( page === lastPage ) {
				setLoadMoreTemplates( { showLoadMore: false } );
			}
		} catch ( error ) {
			toast.error(
				toastBody( {
					message: error?.message?.toString(),
				} )
			);
		} finally {
			setLoadMoreTemplates( { loading: false } );
		}
	};

	useEffect( () => {
		setFocus( 'keyword' );

		// Save the manually entered keyword to session storage.
		return () => {
			const keyword = getValues( 'keyword' );
			if (
				! keyword ||
				keywords.some(
					( item ) => item?.toLowerCase() === keyword?.toLowerCase()
				)
			) {
				return clearSessionStorage( USER_KEYWORD );
			}
			setToSessionStorage( USER_KEYWORD, keyword );
		};
	}, [] );

	useEffect( () => {
		fetchTemplates(
			debouncedKeyword ? debouncedKeyword : getInitialUserKeyword(),
			true
		);
	}, [ debouncedKeyword, selectedBuilder ] );

	const handleSubmitKeyword = ( { keyword } ) => {
		onChangeKeyword( keyword );
	};

	const handleClearSearch = () => {
		if ( ! watchedKeyword ) {
			return;
		}
		reset( { keyword: '' } );
		onChangeKeyword( getInitialUserKeyword() );
	};

	const onChangeKeyword = ( value = '' ) => {
		fetchTemplates( value );
		setWebsiteSelectedTemplateAIStep( '' );
		setSelectedTemplateIsPremium( '' );
	};

	const renderTemplates = useMemo( () => {
		const recommendedTemplates = getTemplates( TEMPLATE_TYPE.RECOMMENDED );
		const partialTemplates = getTemplates( TEMPLATE_TYPE.PARTIAL );
		const genericTemplates = getTemplates( TEMPLATE_TYPE.GENERIC );

		if (
			! recommendedTemplates?.length &&
			! partialTemplates?.length &&
			! genericTemplates?.length
		) {
			return null;
		}

		const recommendedTemplateIdSet = new Set(
			recommendedTemplates.map( ( { uuid } ) => uuid )
		);
		const partialTemplateIdSet = new Set(
			partialTemplates.map( ( { uuid } ) => uuid )
		);

		const filteredGenericTemplates = genericTemplates.filter(
			( { uuid } ) =>
				! recommendedTemplateIdSet.has( uuid ) &&
				! partialTemplateIdSet.has( uuid )
		);

		return (
			<>
				{ recommendedTemplates?.map( ( template, index ) => (
					<ColumnItem
						key={ template.uuid }
						template={ template }
						position={ index + 1 }
					/>
				) ) }
				{ partialTemplates?.map( ( template, index ) => (
					<ColumnItem
						key={ template.uuid }
						template={ template }
						position={
							index + 1 + ( recommendedTemplates?.length || 0 )
						}
					/>
				) ) }
				{ filteredGenericTemplates?.map( ( template, index ) => (
					<ColumnItem
						key={ template.uuid }
						template={ template }
						position={
							index +
							1 +
							( ( recommendedTemplates?.length || 0 ) +
								( partialTemplates?.length || 0 ) )
						}
					/>
				) ) }
			</>
		);
	}, [ getTemplates ] );

	const handleShowBackToTop = ( event ) => {
		const SCROLL_THRESHOLD = 100;
		const { scrollTop } = event.target;

		if ( scrollTop > SCROLL_THRESHOLD && ! backToTop ) {
			setBackToTop( true );
		}
		if ( scrollTop <= SCROLL_THRESHOLD && backToTop ) {
			setBackToTop( false );
		}
	};

	const handleClickBackToTop = () => {
		parentContainer.current.scrollTo( {
			top: 0,
			behavior: 'smooth',
		} );
	};

	return (
		<div
			ref={ parentContainer }
			className={ twMerge(
				`mx-auto flex flex-col overflow-x-hidden`,
				'w-full'
			) }
			onScroll={ handleShowBackToTop }
		>
			<Heading
				heading={ __( 'Choose the Design', 'ai-builder' ) }
				className="px-5 md:px-10 lg:px-14 xl:px-15 pt-5 md:pt-10 lg:pt-8 xl:pt-8 max-w-fit mx-auto"
			/>
			<form
				className="w-full pt-4 pb-4  max-w-[37.5rem] mx-auto"
				onSubmit={ handleSubmit( handleSubmitKeyword ) }
			>
				<div
					className={ classNames(
						'flex w-full bg-white gap-2 items-center rounded-md shadow-sm border border-border-tertiary flex-col-reverse md:flex-row'
					) }
				>
					<SelectTemplatePageBuilderDropdown
						selectedBuilder={ selectedBuilder }
						onChange={ ( builder ) =>
							setSelectedBuilder( builder.id )
						}
					/>
					<Input
						name="keyword"
						inputClassName={ 'pr-11 pl-2' }
						register={ register }
						placeholder={ __( 'Add a keyword', 'ai-builder' ) }
						height="12"
						className="w-full h-12"
						noBorder={ true }
						error={ errors?.keyword }
						suffixIcon={
							<div className="absolute right-4 flex items-center">
								<button
									type="button"
									className="w-auto h-auto p-0 flex items-center justify-center cursor-pointer bg-transparent border-0 focus:outline-none"
									onClick={ handleClearSearch }
								>
									{ watchedKeyword ? (
										<XMarkIcon className="w-5 h-5 text-zip-app-inactive-icon" />
									) : (
										<MagnifyingGlassIcon className="w-5 h-5 text-zip-app-inactive-icon" />
									) }
								</button>
							</div>
						}
					/>
				</div>
			</form>

			<div
				ref={ templatesContainer }
				className={ classNames(
					'custom-confirmation-modal-scrollbar', // class for thin scrollbar
					'relative',
					'px-5 md:px-10 lg:px-14 xl:px-15',
					'xl:max-w-full'
				) }
			>
				<div
					ref={ templatesContainer }
					className={ classNames(
						'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-auto items-start justify-center gap-4 sm:gap-6 mb-10'
					) }
				>
					{ ! isFetching
						? renderTemplates
						: Array.from( { length: 6 } ).map( ( _, index ) => (
								<ColumnSkeleton key={ `skeleton-${ index }` } />
						  ) ) }
				</div>
			</div>

			{ loadMoreTemplates.showLoadMore && (
				<div className="align-center flex justify-center sm:pb-0 pb-40">
					<Button
						className="min-w-[188px] min-h-[50px]"
						variant="primary"
						onClick={ () => {
							if ( loadMoreTemplates.loading ) {
								return;
							}
							fetchAllTemplatesByPage( loadMoreTemplates.page );
							setLoadMoreTemplates( {
								page: loadMoreTemplates.page + 1,
							} );
						} }
						disabled={ loadMoreTemplates.loading }
					>
						{ loadMoreTemplates.loading ? (
							<LoadingSpinner />
						) : (
							__( 'Load More Designs', 'ai-builder' )
						) }
					</Button>
				</div>
			) }

			{ backToTop && (
				<div className="absolute right-20 bottom-28 ml-auto">
					<button
						type="button"
						className="absolute bottom-0 right-0 z-10 w-8 h-8 rounded-full bg-accent-st border-0 border-solid text-white flex items-center justify-center shadow-sm cursor-pointer"
						onClick={ handleClickBackToTop }
					>
						<ChevronUpIcon className="w-5 h-5" />
					</button>
				</div>
			) }

			<div className="fixed sm:sticky bottom-0 w-full bg-container-background py-4.75 px-5 md:px-10 lg:px-14 xl:px-15">
				<NavigationButtons
					onClickPrevious={ previousStep }
					hideContinue
				/>
			</div>
		</div>
	);
};

export default SelectTemplate;
